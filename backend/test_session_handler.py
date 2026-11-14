import unittest
from unittest.mock import MagicMock, patch
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lambda'))
import session_handler

class TestSessionHandler(unittest.TestCase):

    def setUp(self):
        session_handler.SESSIONS_BUCKET = 'mock-sessions-bucket'
        self.mock_s3 = MagicMock()
        session_handler.s3_client = self.mock_s3

    def test_options_cors(self):
        event = {
            'httpMethod': 'OPTIONS',
            'rawPath': '/api/sessions'
        }
        res = session_handler.handler(event, None)
        self.assertEqual(res['statusCode'], 200)
        self.assertIn('Access-Control-Allow-Origin', res['headers'])

    def test_post_valid_session(self):
        payload = {
            'stats': {'fans': 10, 'mutuals': 20},
            'users': [{'username': 'user1', 'followedByViewer': True, 'followsViewer': False}]
        }
        event = {
            'httpMethod': 'POST',
            'rawPath': '/api/sessions',
            'body': json.dumps(payload),
            'isBase64Encoded': False
        }
        res = session_handler.handler(event, None)
        self.assertEqual(res['statusCode'], 201)
        body = json.loads(res['body'])
        self.assertEqual(body['status'], 'success')
        self.assertTrue('sessionId' in body)
        self.mock_s3.put_object.assert_called_once()

    def test_post_invalid_payload(self):
        event = {
            'httpMethod': 'POST',
            'rawPath': '/api/sessions',
            'body': json.dumps({'invalid': 'no users'}),
            'isBase64Encoded': False
        }
        res = session_handler.handler(event, None)
        self.assertEqual(res['statusCode'], 400)
        body = json.loads(res['body'])
        self.assertIn('error', body)

    def test_get_session_success(self):
        test_data = {'stats': {'fans': 5}, 'users': [{'username': 'alex'}]}
        mock_body = MagicMock()
        mock_body.read.return_value = json.dumps(test_data).encode('utf-8')
        self.mock_s3.get_object.return_value = {'Body': mock_body}

        event = {
            'httpMethod': 'GET',
            'rawPath': '/api/sessions/test-uuid-1234',
            'pathParameters': {'id': 'test-uuid-1234'}
        }
        res = session_handler.handler(event, None)
        self.assertEqual(res['statusCode'], 200)
        data = json.loads(res['body'])
        self.assertEqual(data['users'][0]['username'], 'alex')

    def test_get_session_sanitization(self):
        test_data = {'users': []}
        mock_body = MagicMock()
        mock_body.read.return_value = json.dumps(test_data).encode('utf-8')
        self.mock_s3.get_object.return_value = {'Body': mock_body}

        event = {
            'httpMethod': 'GET',
            'rawPath': '/api/sessions/../../evil-id',
            'pathParameters': {'id': '../../evil-id'}
        }
        session_handler.handler(event, None)
        # Check that path traversal was sanitized
        called_key = self.mock_s3.get_object.call_args[1]['Key']
        self.assertEqual(called_key, 'sessions/evil-id.json')

if __name__ == '__main__':
    unittest.main()
