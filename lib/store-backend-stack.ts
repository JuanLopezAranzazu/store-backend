import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as rds from "aws-cdk-lib/aws-rds";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class StoreBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --------------------------------------------------
    // VPC
    // --------------------------------------------------

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

    // --------------------------------------------------
    // S3 - Product Images
    // --------------------------------------------------

    const imagesBucket = new s3.Bucket(this, "ProductImagesBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      encryption: s3.BucketEncryption.S3_MANAGED,

      lifecycleRules: [
        {
          id: "MoveOldImagesToIA",
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

    // --------------------------------------------------
    // DynamoDB - Orders
    // --------------------------------------------------

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

      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --------------------------------------------------
    // RDS PostgreSQL - Product Catalog
    // --------------------------------------------------

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

    // --------------------------------------------------
    // EC2 - Temporary Order Processing
    // --------------------------------------------------

    const processingSecurityGroup = new ec2.SecurityGroup(
      this,
      "ProcessingSecurityGroup",
      {
        vpc,
        description: "Security group for order processing instance",
        allowAllOutbound: true,
      },
    );

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

    // --------------------------------------------------
    // Outputs
    // --------------------------------------------------

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

    new cdk.CfnOutput(this, "ProcessingInstanceId", {
      value: processingInstance.instanceId,
    });
  }
}
