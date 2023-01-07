import * as _iam from 'aws-cdk-lib/aws-iam';

export const cwAgentPolicy = new _iam.PolicyStatement({
  effect: _iam.Effect.ALLOW,
  actions: [
    'cloudwatch:PutMetricData',
    'ec2:DescribeVolumes',
    'ec2:DescribeTags',
    'logs:PutLogEvents',
    'logs:DescribeLogStreams',
    'logs:DescribeLogGroups',
    'logs:CreateLogStream',
    'logs:CreateLogGroup',
    'logs:PutRetentionPolicy',
  ],
  resources: ['*'],
});
