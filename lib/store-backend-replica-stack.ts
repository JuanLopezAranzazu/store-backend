import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";

export class StoreBackendReplicaStack extends cdk.Stack {
  public readonly replicaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.replicaBucket = new s3.Bucket(this, "ProductImagesReplicaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      encryption: s3.BucketEncryption.S3_MANAGED,

      versioned: true,

      removalPolicy: cdk.RemovalPolicy.DESTROY,

      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, "ReplicaBucketArn", {
      value: this.replicaBucket.bucketArn,
    });

    new cdk.CfnOutput(this, "ReplicaBucketName", {
      value: this.replicaBucket.bucketName,
    });
  }
}
