import { AWSError } from 'aws-sdk';
import { Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDynamoClient, instanceInfoTableConfig } from '/opt/nodejs/helpers';

const client = getDynamoClient();

export const handler = async (_: APIGatewayProxyEvent, __: Context): Promise<APIGatewayProxyResult> => {
  try {
    const scanResults = await client.scan({ TableName: instanceInfoTableConfig.tableName }).promise();
    const res = {
      count: scanResults.Count,
      scannedCount: scanResults.ScannedCount,
      items: scanResults.Items?.map((item) => {
        return {
          id: item['instance_id']['S'] ?? '',
          name: item['i_name']['S'] ?? '',
          state: item['i_state']['S'] ?? '',
          env: item['i_env']['S'] ?? '',
          tier: item['i_tier']['S'] ?? '',
          minionId: item['minion_id']['S'] ?? '',
          privateIp: item['i_private_ip']['S'] ?? '',
          publicIp: item['i_public_ip']['S'] ?? '',
          updatedAt: item['updated_at']['S'] ?? '',
        };
      }),
    };
    return {
      statusCode: 200,
      headers: {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
      },
      body: JSON.stringify(res),
    };
  } catch (e) {
    const err = e as AWSError;
    console.error('SCAN-DDB-TABLE::: ', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? 'unknown error' }),
    };
  }
};
