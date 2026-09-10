import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  FieldRow,
  FieldHalf,
  DataTable,
} from '../../components/SharedUI';

export default function OrderInquiriesView() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  return (
    <View>
      <Card>
        <CardHeading title="Submitted order inquiries" />
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
            'Category',
            'Email',
            'Products',
            'Estimated Cost',
            'Delivery & Payment',
            'Status',
            'Date',
            'Actions',
          ]}
          rows={[]}
        />
      </Card>
    </View>
  );
}