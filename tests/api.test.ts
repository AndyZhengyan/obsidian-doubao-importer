import { expect, it } from 'vitest';
import { buildMessageRequest, buildRecentRequest } from '../src/api';

it('builds read-only Doubao IM requests with string-preserved IDs', () => {
  expect(buildRecentRequest(200)).toMatchObject({
    cmd: 3200,
    uplink_body: { pull_recent_conv_chain_uplink_body: { limit: 200, option: { not_need_message: true } } },
  });
  expect(buildMessageRequest('9007199254740999', '9007199254740991')).toMatchObject({
    cmd: 3100,
    uplink_body: { pull_singe_chain_uplink_body: { conversation_id: '9007199254740999', anchor_index: '9007199254740991', direction: 1 } },
  });
});
