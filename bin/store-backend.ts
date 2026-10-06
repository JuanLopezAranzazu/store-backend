#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StoreBackendStack } from "../lib/store-backend-stack";
import { StoreBackendReplicaStack } from "../lib/store-backend-replica-stack";

const app = new cdk.App();

new StoreBackendStack(app, "StoreBackendStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
});

new StoreBackendReplicaStack(app, "StoreBackendReplicaStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-west-2",
  },
});
