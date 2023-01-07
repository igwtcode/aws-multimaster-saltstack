import { EC2, SSM, AutoScaling, DynamoDB } from 'aws-sdk';

const defaultClientParams = { region: process.env.REGION, sslEnabled: true };

export function getEc2Client(config?: EC2.ClientConfiguration) {
  return new EC2({ ...defaultClientParams, ...config });
}

export function getSsmClient(config?: SSM.ClientConfiguration) {
  return new SSM({ ...defaultClientParams, ...config });
}

export function getAsgClient(config?: AutoScaling.ClientConfiguration) {
  return new AutoScaling({ ...defaultClientParams, ...config });
}

export function getDynamoClient(config?: DynamoDB.ClientConfiguration) {
  return new DynamoDB({ ...defaultClientParams, ...config });
}

export async function sleep(seconds: number): Promise<any> {
  return new Promise((r) => setTimeout(r, seconds * 1000));
}
