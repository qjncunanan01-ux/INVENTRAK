#!/usr/bin/env node
// Backfill the OpenAPI contract with the four new backend paths the spec audit
// flagged: /api/unit-conversions, /api/notifications, /api/back-orders,
// /api/correction-requests, plus /api/order-inquiries/{id}/back-order.
//
// Style is matched to the existing spec (tags, security, responses refs, etc.),
// and the new schemas are inserted in alphabetical key order inside
// components.schemas.

const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.resolve(__dirname, '../openapi.json');

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

if (!spec.components || !spec.components.schemas) {
  throw new Error('openapi.json is missing components.schemas');
}

function ensureSchema(key, block) {
  if (spec.components.schemas[key]) {
    throw new Error(`components.schemas already has "${key}" — refusing to overwrite`);
  }
  spec.components.schemas[key] = block;
}

function insertPathsAfter(anchorKey, entries) {
  const keys = Object.keys(spec.paths);
  const idx = keys.indexOf(anchorKey);
  if (idx < 0) throw new Error(`paths does not contain anchor "${anchorKey}"`);
  for (const [p, ops] of entries) {
    if (spec.paths[p]) {
      throw new Error(`paths already has "${p}" — refusing to overwrite`);
    }
    spec.paths[p] = ops;
  }
  // Re-sort path keys alphabetically to match the existing file shape.
  spec.paths = Object.fromEntries(
    Object.entries(spec.paths).sort(([a], [b]) => a.localeCompare(b))
  );
}

// New schemas (alphabetical by key when inserted).
ensureSchema('CorrectionRequestInput', {
  type: 'object',
  required: ['submission_id', 'submission_type', 'comment'],
  properties: {
    submission_id: { type: 'integer', description: 'The admin-facing submission this correction targets (adjustment id or transfer id).' },
    submission_type: {
      type: 'string',
      enum: ['stock_adjustment', 'stock_transfer'],
      description: 'Kind of submission being corrected.'
    },
    comment: { type: 'string', description: 'What the approver wants the submitter to fix.' }
  }
});

ensureSchema('CorrectionRequest', {
  type: 'object',
  required: ['id', 'submission_id', 'submission_type', 'comment', 'requested_by', 'status', 'created_at'],
  properties: {
    id: { type: 'integer' },
    submission_id: { type: 'integer' },
    submission_type: { type: 'string' },
    comment: { type: 'string' },
    requested_by: { type: 'string', nullable: true, description: 'Username of the admin who recorded the correction request.' },
    status: { type: 'string', enum: ['open', 'closed'], description: 'Whether the submitter has addressed it.' },
    created_at: { type: 'string' }
  }
});

ensureSchema('CorrectionRequestResolve', {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['open', 'closed'], default: 'closed' }
  }
});

ensureSchema('NotificationsList', {
  type: 'object',
  required: ['rows', 'total', 'limit', 'offset'],
  properties: {
    rows: {
      type: 'array',
      items: { $ref: '#/components/schemas/NotificationRecord' }
    },
    total: { type: 'integer' },
    limit: { type: 'integer' },
    offset: { type: 'integer' }
  }
});

ensureSchema('NotificationRecord', {
  type: 'object',
  required: ['id', 'event', 'channel', 'status', 'created_at'],
  properties: {
    id: { type: 'integer' },
    event: { type: 'string' },
    channel: { type: 'string', enum: ['email', 'sms', ''] },
    recipient: { type: 'string', nullable: true },
    subject: { type: 'string', nullable: true },
    status: {
      type: 'string',
      enum: ['attempted', 'sent', 'failed', ''],
      description: 'Best-effort delivery status from the notification layer.'
    },
    detail: { type: 'string', nullable: true },
    related_id: { type: 'integer', nullable: true },
    related_type: { type: 'string', nullable: true },
    created_at: { type: 'string' }
  }
});

ensureSchema('UnitConversionInput', {
  type: 'object',
  required: ['from_unit', 'to_unit', 'rate'],
  properties: {
    from_unit: { type: 'string', description: 'Source unit (e.g. kg, L, pcs).' },
    to_unit: { type: 'string', description: 'Target unit (e.g. g, mL, pack).' },
    rate: { type: 'number', minimum: 0, exclusiveMinimum: true, description: 'How many to_unit equal one from_unit.' },
    note: { type: 'string', nullable: true }
  }
});

ensureSchema('UnitConversion', {
  type: 'object',
  required: ['id', 'from_unit', 'to_unit', 'rate', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'integer' },
    from_unit: { type: 'string' },
    to_unit: { type: 'string' },
    rate: { type: 'number' },
    note: { type: 'string', nullable: true },
    created_by: { type: 'string', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' }
  }
});

ensureSchema('BackOrderInput', {
  type: 'object',
  required: ['inquiry_id'],
  properties: {
    inquiry_id: { type: 'integer', description: 'Order inquiry this back order is attached to.' },
    reason: { type: 'string', nullable: true },
    requested_by_date: { type: 'string', format: 'date', nullable: true },
    status: { type: 'string', enum: ['open', 'fulfilled', 'cancelled'], nullable: true },
    note: { type: 'string', nullable: true }
  }
});

ensureSchema('BackOrder', {
  type: 'object',
  required: ['id', 'inquiry_id', 'status', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'integer' },
    inquiry_id: { type: 'integer' },
    reason: { type: 'string', nullable: true },
    requested_by_date: { type: 'string', format: 'date', nullable: true },
    status: { type: 'string', enum: ['open', 'fulfilled', 'cancelled'] },
    note: { type: 'string', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' }
  }
});

// New paths, inserted after /api/inventory/counts alphabetically.
insertPathsAfter('/api/inventory/counts', [
  [
    '/api/unit-conversions',
    {
      get: {
        tags: ['Inventory'],
        operationId: 'listUnitConversions',
        summary: 'List the unit conversion catalog (admin only)',
        description: 'Linear rate conversions used by unit conversion management (kg<->g, L<->mL, pcs<->pack, etc.).',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Unit conversions',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/UnitConversion' } }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' }
        }
      },
      post: {
        tags: ['Inventory'],
        operationId: 'upsertUnitConversion',
        summary: 'Create or update one unit conversion rate (admin only)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UnitConversionInput' } }
          }
        },
        responses: {
          '200': {
            description: 'Conversion upserted',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UnitConversion' } }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' }
        }
      }
    }
  ],
  [
    '/api/unit-conversions/{id}',
    {
      delete: {
        tags: ['Inventory'],
        operationId: 'deleteUnitConversion',
        summary: 'Remove a unit conversion (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          '200': {
            description: 'Conversion removed',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Message' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  ],
  [
    '/api/notifications',
    {
      get: {
        tags: ['Users'],
        operationId: 'listNotifications',
        summary: 'Paginated notification records (admin only)',
        description: 'Dedicated admin notification ledger: every notification attempt is recorded here with event, channel, recipient, and best-effort delivery status.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          { name: 'event', in: 'query', schema: { type: 'string' } },
          { name: 'channel', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Notification records',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NotificationsList' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' }
        }
      }
    }
  ],
  [
    '/api/notifications/{id}',
    {
      get: {
        tags: ['Users'],
        operationId: 'getNotification',
        summary: 'Single notification record (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          '200': {
            description: 'Notification record',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NotificationRecord' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  ],
  [
    '/api/back-orders',
    {
      get: {
        tags: ['Order Inquiries'],
        operationId: 'listBackOrders',
        summary: 'List back orders',
        description: 'Back-order management list. Any authenticated caller may read it; admins may also create/update back orders.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Back orders',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/BackOrder' } }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      },
      post: {
        tags: ['Order Inquiries'],
        operationId: 'upsertBackOrder',
        summary: 'Create or update a back order (admin may also set status)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BackOrderInput' } }
          }
        },
        responses: {
          '200': {
            description: 'Back order upserted',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BackOrder' } }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    }
  ],
  [
    '/api/back-orders/{id}',
    {
      get: {
        tags: ['Order Inquiries'],
        operationId: 'getBackOrder',
        summary: 'Get a back order by inquiry id',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          '200': {
            description: 'Back order',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BackOrder' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  ],
  [
    '/api/correction-requests',
    {
      get: {
        tags: ['Stock Movements'],
        operationId: 'listCorrectionRequests',
        summary: 'List correction requests (admin only)',
        description: 'Approver comments and correction requests. Open items are things staff should address before resubmitting.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'submission_id', in: 'query', schema: { type: 'integer' } },
          { name: 'status', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Correction requests',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/CorrectionRequest' } }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' }
        }
      },
      post: {
        tags: ['Stock Movements'],
        operationId: 'createCorrectionRequest',
        summary: 'Record a reject comment / correction request (admin only)',
        description: 'Attach a visible correction request to a submission so staff can see what to fix. Requires submission_id and a comment.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CorrectionRequestInput' } }
          }
        },
        responses: {
          '200': {
            description: 'Correction request created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CorrectionRequest' } }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' }
        }
      }
    }
  ],
  [
    '/api/correction-requests/{id}',
    {
      get: {
        tags: ['Stock Movements'],
        operationId: 'getCorrectionRequest',
        summary: 'Single correction request (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          '200': {
            description: 'Correction request',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CorrectionRequest' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  ],
  [
    '/api/correction-requests/{id}/resolve',
    {
      post: {
        tags: ['Stock Movements'],
        operationId: 'resolveCorrectionRequest',
        summary: 'Mark a correction request as addressed (admin only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CorrectionRequestResolve' } }
          }
        },
        responses: {
          '200': {
            description: 'Correction request updated',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CorrectionRequest' } }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  ]
]);

fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2) + '\n');
console.log('openapi.json updated with the four flagged paths plus schemas.');
console.log('New paths:');
['/api/unit-conversions', '/api/unit-conversions/{id}', '/api/notifications', '/api/notifications/{id}', '/api/back-orders', '/api/back-orders/{id}', '/api/correction-requests', '/api/correction-requests/{id}', '/api/correction-requests/{id}/resolve'].forEach(p => console.log(' -', p));
