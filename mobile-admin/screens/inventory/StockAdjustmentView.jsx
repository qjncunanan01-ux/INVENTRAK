import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  FieldRow,
  FieldHalf,
  ActionButton,
  DataTable,
} from '../../components/SharedUI';

export default function StockAdjustmentView() {
  const [form, setForm] = useState({
    product: '',
    location: '',
    correctedQuantity: '',
    reason: '',
  });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const setField = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <View>
      <Card>
        <CardHeading
          title="New adjustment request"
          subtitle="Propose a corrected quantity (inventory count, damage, shrinkage). The change only applies to stock after an admin approves it."
        />

        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Product"
              value={form.product}
              onChangeText={setField('product')}
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Location"
              value={form.location}
              onChangeText={setField('location')}
            />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Corrected Quantity"
              value={form.correctedQuantity}
              onChangeText={setField('correctedQuantity')}
              keyboardType="numeric"
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Reason"
              value={form.reason}
              onChangeText={setField('reason')}
            />
          </FieldHalf>
        </FieldRow>

        <ActionButton label="Request adjustment" onPress={() => {}} />
      </Card>

      <Card>
        <CardHeading title="Adjustment history" />
        <FieldRow>
          <FieldHalf>
            <PillInput placeholder="Status" value={status} onChangeText={setStatus} />
          </FieldHalf>
          <FieldHalf>
            <PillInput placeholder="Search" value={search} onChangeText={setSearch} />
          </FieldHalf>
        </FieldRow>

        <DataTable
          columns={[
            'Product',
            'Location',
            'Current',
            'Corrected to',
            'Reason',
            'Status',
            'Decided by',
            'Date',
            'Actions',
          ]}
          rows={[]}
        />
      </Card>
    </View>
  );
}
