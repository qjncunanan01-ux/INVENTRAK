import React from 'react';
import { View } from 'react-native';
import { Card, CardHeading, ActionButton, ButtonRow } from '../../components/SharedUI';

export default function ScanBlockView() {
  return (
    <View>
      <Card>
        <CardHeading
          title="Scan a product label"
          subtitle="The daily manual-inventory answer: snap or upload a label, and the OCR engine matches it to the catalog with the live stock at every location."
        />

        <ButtonRow>
          <ActionButton
            label="Live Camera"
            variant="primary"
            onPress={() => {}}
            style={{ marginRight: 8 }}
          />
          <ActionButton label="Take Photo" onPress={() => {}} style={{ marginRight: 8 }} />
          <ActionButton label="Upload Image" onPress={() => {}} />
        </ButtonRow>
      </Card>
    </View>
  );
}