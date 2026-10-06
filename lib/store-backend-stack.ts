import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as rds from "aws-cdk-lib/aws-rds";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";

export class StoreBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "StoreVpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      natGateways: 0,

      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // EC2 Security Group
    const processingSecurityGroup = new ec2.SecurityGroup(
      this,
      "ProcessingSecurityGroup",
      {
        vpc,
        description: "Security group for order processing instance",
        allowAllOutbound: true,
      },
    );

    // RDS Security Group
    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc,
        description: "Security group for PostgreSQL database",
        allowAllOutbound: true,
      },
    );

    // Allow EC2 to access PostgreSQL
    databaseSecurityGroup.addIngressRule(
      processingSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL access from order processing instance",
    );

    // S3 - Product Images
    const imagesBucket = new s3.Bucket(this, "ProductImagesBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,

      versioned: true,

      lifecycleRules: [
        {
          id: "TransitionImagesToStandardIA",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],

      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 Cross-Region Replication destination
    const replicaBucketArn = new cdk.CfnParameter(this, "ReplicaBucketArn", {
      type: "String",
      description: "ARN of the S3 bucket in the replica region",
    });

    // S3 Replication IAM Role
    const replicationRole = new iam.Role(this, "S3ReplicationRole", {
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
      description: "IAM role used by S3 for cross-region replication",
    });

    // Allow S3 to read replication configuration
    // and list objects in the source bucket
    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"],
        resources: [imagesBucket.bucketArn],
      }),
    );

    // Allow S3 to read object versions
    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging",
        ],
        resources: [`${imagesBucket.bucketArn}/*`],
      }),
    );

    // Allow S3 to replicate objects
    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
        ],
        resources: [`${replicaBucketArn.valueAsString}/*`],
      }),
    );

    // Configure Cross-Region Replication
    const sourceBucket = imagesBucket.node.defaultChild as s3.CfnBucket;

    sourceBucket.replicationConfiguration = {
      role: replicationRole.roleArn,

      rules: [
        {
          id: "ReplicateProductImages",
          status: "Enabled",

          destination: {
            bucket: replicaBucketArn.valueAsString,
          },
        },
      ],
    };

    // DynamoDB - Orders
    const ordersTable = new dynamodb.Table(this, "OrdersTable", {
      partitionKey: {
        name: "customerId",
        type: dynamodb.AttributeType.STRING,
      },

      sortKey: {
        name: "orderId",
        type: dynamodb.AttributeType.STRING,
      },

      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,

      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // RDS PostgreSQL - Product Catalog
    const database = new rds.DatabaseInstance(this, "ProductCatalogDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),

      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),

      vpc,

      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },

      securityGroups: [databaseSecurityGroup],

      publiclyAccessible: false,

      allocatedStorage: 20,

      maxAllocatedStorage: 50,

      storageEncrypted: true,

      databaseName: "store",

      credentials: rds.Credentials.fromGeneratedSecret("postgres"),

      backupRetention: cdk.Duration.days(1),

      deletionProtection: false,

      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // RDS Read Replica
    const readReplica = new rds.DatabaseInstanceReadReplica(
      this,
      "ProductCatalogReadReplica",
      {
        sourceDatabaseInstance: database,

        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO,
        ),

        vpc,

        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },

        publiclyAccessible: false,

        securityGroups: [databaseSecurityGroup],

        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    // EC2 - Temporary Order Processing
    const processingInstance = new ec2.Instance(
      this,
      "OrderProcessingInstance",
      {
        vpc,

        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },

        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO,
        ),

        machineImage: ec2.MachineImage.latestAmazonLinux2023(),

        securityGroup: processingSecurityGroup,

        blockDevices: [
          {
            deviceName: "/dev/sdf",

            volume: ec2.BlockDeviceVolume.ebs(10, {
              encrypted: true,
              deleteOnTermination: true,
            }),
          },
        ],
      },
    );

    // Outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: vpc.vpcId,
    });

    new cdk.CfnOutput(this, "ImagesBucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "OrdersTableName", {
      value: ordersTable.tableName,
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.dbInstanceEndpointAddress,
    });

    new cdk.CfnOutput(this, "DatabasePort", {
      value: database.dbInstanceEndpointPort,
    });

    new cdk.CfnOutput(this, "ReadReplicaEndpoint", {
      value: readReplica.dbInstanceEndpointAddress,
    });

    new cdk.CfnOutput(this, "ProcessingInstanceId", {
      value: processingInstance.instanceId,
    });
  }
}
