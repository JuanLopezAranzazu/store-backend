#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StoreBackendStack } from "../lib/store-backend-stack";

const app = new cdk.App();

new StoreBackendStack(app, "StoreBackendStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
