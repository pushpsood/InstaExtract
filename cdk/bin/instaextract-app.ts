#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InstaextractStack } from '../lib/instaextract-stack';

const app = new cdk.App();

new InstaextractStack(app, 'InstaextractStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '851725215059',
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
  },
  description: 'InstaExtract: Serverless Instagram Audit & Unfollow Web Platform with Method B Mobile QR Sync',
});

app.synth();
