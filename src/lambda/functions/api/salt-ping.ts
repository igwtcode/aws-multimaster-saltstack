import { AWSError } from 'aws-sdk';
import { Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { customHeader } from '/opt/nodejs/helpers';
import { axios as axiosLib } from '/opt/nodejs/http-utils';

const SALT_API_URL = process.env.SALT_API_URL!;
const SALT_API_USERNAME = process.env.SALT_API_USERNAME!;
const SALT_API_PASSWORD = process.env.SALT_API_PASSWORD!;

const axios = axiosLib.default;
axios.defaults.headers.common[customHeader.name] = customHeader.value; // for all requests

export const handler = async (_: APIGatewayProxyEvent, __: Context): Promise<APIGatewayProxyResult> => {
  try {
    const saltPingRequest = await axios.post(`${SALT_API_URL}/run`, {
      eauth: 'pam',
      username: SALT_API_USERNAME,
      password: SALT_API_PASSWORD,
      client: 'local',
      tgt: '*',
      fun: 'test.ping',
    });
    console.log(saltPingRequest.data);
    let ret = saltPingRequest.data?.return?.at(0) ?? saltPingRequest.data;
    return {
      statusCode: 200,
      headers: {
        'Content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
      },
      body: JSON.stringify(ret),
    };
  } catch (e) {
    const err = e as AWSError;
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
