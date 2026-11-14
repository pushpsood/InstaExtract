import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as path from 'path';

export class InstaextractStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. S3 Bucket for Static Frontend Assets (HTML, CSS, JS, QR lib)
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    // 2. S3 Bucket for Ephemeral Sessions (Method B Mobile Sync)
    // Automatically purged after 24 hours via S3 lifecycle rule
    const sessionsBucket = new s3.Bucket(this, 'SessionsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'PurgeEphemeralSessionsAfter24Hours',
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // 3. Lambda Function for Ephemeral Session Handler (Mumbai ap-south-1)
    const sessionLambda = new lambda.Function(this, 'SessionHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'session_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/lambda')),
      environment: {
        SESSIONS_BUCKET: sessionsBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      description: 'InstaExtract Ephemeral Session Sync API Handler (Mumbai ap-south-1)',
    });

    // Grant Lambda Read/Write access to the sessions bucket
    sessionsBucket.grantReadWrite(sessionLambda);

    // 4. API Gateway REST API with Lambda Proxy Integration (Mumbai ap-south-1)
    const api = new apigateway.LambdaRestApi(this, 'SessionApi', {
      handler: sessionLambda,
      proxy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
      deployOptions: {
        stageName: 'prod',
      },
    });

    // 5. SSL Certificate for Custom Domain instaextract.in & www.instaextract.in
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'SiteCertificate',
      'arn:aws:acm:us-east-1:851725215059:certificate/1bdce065-665e-49d5-8cfe-11279eb16b61'
    );

    // 6. CloudFront CDN Distribution (Single Unified Origin)
    // Routes static web assets from S3 and /api/* calls to API Gateway
    const distribution = new cloudfront.Distribution(this, 'InstaExtractDistribution', {
      domainNames: ['instaextract.in', 'www.instaextract.in'],
      certificate: certificate,
      defaultRootObject: 'index.html',
      comment: 'InstaExtract CloudFront CDN Distribution (instaextract.in)',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // 7. Route 53 DNS Configuration for instaextract.in and www.instaextract.in
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z00234906NHV6M71LO1M',
      zoneName: 'instaextract.in',
    });

    // Apex record: instaextract.in (A)
    new route53.ARecord(this, 'ApexAliasRecord', {
      zone: hostedZone,
      recordName: 'instaextract.in',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Apex record: instaextract.in (AAAA - IPv6)
    new route53.AaaaRecord(this, 'ApexAaaaAliasRecord', {
      zone: hostedZone,
      recordName: 'instaextract.in',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Subdomain record: www.instaextract.in (A)
    new route53.ARecord(this, 'WwwAliasRecord', {
      zone: hostedZone,
      recordName: 'www.instaextract.in',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Subdomain record: www.instaextract.in (AAAA - IPv6)
    new route53.AaaaRecord(this, 'WwwAaaaAliasRecord', {
      zone: hostedZone,
      recordName: 'www.instaextract.in',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // 8. Deploy Web Assets to Frontend S3 Bucket & Invalidate CDN Cache
    new s3deploy.BucketDeployment(this, 'DeployFrontendAssets', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../web'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // 9. Stack Outputs
    new cdk.CfnOutput(this, 'CustomDomainUrl', {
      value: 'https://instaextract.in',
      description: 'InstaExtract Custom Domain URL',
      exportName: 'InstaExtractCustomDomainUrl',
    });

    new cdk.CfnOutput(this, 'WwwCustomDomainUrl', {
      value: 'https://www.instaextract.in',
      description: 'InstaExtract WWW Custom Domain URL',
    });

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'InstaExtract CloudFront Distribution URL',
      exportName: 'InstaExtractCloudFrontUrl',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'InstaExtract API Gateway Endpoint',
      exportName: 'InstaExtractApiGatewayUrl',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 Frontend Bucket Name',
    });

    new cdk.CfnOutput(this, 'SessionsBucketName', {
      value: sessionsBucket.bucketName,
      description: 'S3 Ephemeral Sessions Bucket Name (24h TTL)',
    });
  }
}
