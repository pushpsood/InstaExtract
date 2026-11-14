import json
import os
import uuid
import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')
SESSIONS_BUCKET = os.environ.get('SESSIONS_BUCKET', '')

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
    'Content-Type': 'application/json'
}

def handler(event, context):
    """
    AWS Lambda handler for InstaExtract ephemeral session sync.
    Supports:
      - OPTIONS: Pre-flight CORS
      - POST /api/sessions: Save ephemeral audit dataset (24h TTL via S3 lifecycle)
      - GET /api/sessions/{id}: Retrieve dataset for mobile QR view
    """
    http_method = event.get('requestContext', {}).get('http', {}).get('method') or event.get('httpMethod', 'GET')
    
    # Handle pre-flight CORS
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'status': 'ok'})
        }

    path = event.get('rawPath') or event.get('path', '')
    path_parameters = event.get('pathParameters') or {}
    session_id = path_parameters.get('id')

    if not session_id and '/api/sessions/' in path:
        session_id = path.split('/api/sessions/')[-1].strip()

    # Route: POST /api/sessions (Create ephemeral session)
    if http_method == 'POST':
        try:
            body_str = event.get('body', '{}')
            if event.get('isBase64Encoded', False):
                import base64
                body_str = base64.b64decode(body_str).decode('utf-8')
            
            data = json.loads(body_str)
            if not isinstance(data, dict) or 'users' not in data:
                return {
                    'statusCode': 400,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Invalid payload. Missing users array.'})
                }

            # Generate cryptographically secure UUID
            new_session_id = str(uuid.uuid4())
            object_key = f"sessions/{new_session_id}.json"

            # Store in S3 ephemeral bucket
            s3_client.put_object(
                Bucket=SESSIONS_BUCKET,
                Key=object_key,
                Body=json.dumps(data),
                ContentType='application/json'
            )

            return {
                'statusCode': 201,
                'headers': CORS_HEADERS,
                'body': json.dumps({
                    'status': 'success',
                    'sessionId': new_session_id,
                    'expiresIn': '24 hours'
                })
            }
        except Exception as e:
            return {
                'statusCode': 500,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'Failed to store session: {str(e)}'})
            }

    # Route: GET /api/sessions/{id} (Retrieve ephemeral session)
    elif http_method == 'GET' and session_id:
        try:
            # Sanitize session_id to prevent directory traversal
            clean_id = ''.join(c for c in session_id if c.isalnum() or c in '-_')
            object_key = f"sessions/{clean_id}.json"

            response = s3_client.get_object(
                Bucket=SESSIONS_BUCKET,
                Key=object_key
            )
            content = response['Body'].read().decode('utf-8')

            return {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': content
            }
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                return {
                    'statusCode': 404,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Session not found or expired.'})
                }
            return {
                'statusCode': 500,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'S3 Error: {str(e)}'})
            }
        except Exception as e:
            return {
                'statusCode': 500,
                'headers': CORS_HEADERS,
                'body': json.dumps({'error': str(e)})
            }

    return {
        'statusCode': 404,
        'headers': CORS_HEADERS,
        'body': json.dumps({'error': 'Not found'})
    }
