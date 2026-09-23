import React from 'react';
import { View } from 'react-native';
import { Card, CardHeading, ActionButton, ButtonRow } from '../../components/SharedUI';

export default function ScanBlockView() {
  return (
    <View>
      <Card>
        <CardHeading
          title="Scan a product QR tag"
          subtitle="The daily manual-inventory answer: scan a printed product tag, and the system resolves it to the catalog with the live stock at every location."
        />

        <ButtonRow>
          <ActionButton
            label="Live Camera"
            variant="primary"
            onPress={() => {}}
            style={{ marginRight: 8 }}
          />
          <ActionButton label="Paste Tag Payload" onPress={() => {}} style={{ marginRight: 8 }} />
          <ActionButton label="Upload Tag Image" onPress={() => {}} />
        </ButtonRow>
      </Card>
    </View>
  );
}