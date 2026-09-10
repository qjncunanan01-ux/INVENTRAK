import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  ActionButton,
  DataTable,
} from '../../components/SharedUI';

export default function BranchLocationsView() {
  const [newLocation, setNewLocation] = useState('');
  const [search, setSearch] = useState('');

  return (
    <View>
      <Card>
        <CardHeading
          title="Manage Inventory locations"
          subtitle="Add or remove storeroom locations used for tracking inventory levels."
        />
        <PillInput
          placeholder="New location"
          value={newLocation}
          onChangeText={setNewLocation}
        />
        <ActionButton label="Add location" onPress={() => {}} />
      </Card>

      <Card>
        <CardHeading title="Locations" />
        <PillInput placeholder="Search" value={search} onChangeText={setSearch} />
        <DataTable columns={['ID', 'Name', 'Actions']} rows={[]} />
      </Card>
    </View>
  );
}