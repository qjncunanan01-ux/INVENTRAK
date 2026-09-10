import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Card,
  CardHeading,
  PillInput,
  FieldRow,
  FieldHalf,
  ActionButton,
  ButtonRow,
  DataTable,
} from '../../components/SharedUI';

const SAMPLE_BULK_TEXT = 'Almond Roca, 520\nBlueberry, 495\nCaramel Syrup';

export default function ProductsView() {
  const [form, setForm] = useState({
    name: '',
    category: '',
    brand: '',
    size: '',
    unit: '',
    price: '',
    description: '',
    imageUrl: '',
  });
  const [bulkText, setBulkText] = useState(SAMPLE_BULK_TEXT);
  const [locationSearch, setLocationSearch] = useState('');

  const setField = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <View>
      <Card>
        <CardHeading
          title="Product catalog controls"
          subtitle="Add, edit, and manage product details for inventory tracking."
        />

        <FieldRow>
          <FieldHalf>
            <PillInput placeholder="Name" value={form.name} onChangeText={setField('name')} />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Category"
              value={form.category}
              onChangeText={setField('category')}
            />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Brand"
              value={form.brand}
              onChangeText={setField('brand')}
            />
          </FieldHalf>
          <FieldHalf>
            <PillInput placeholder="Size" value={form.size} onChangeText={setField('size')} />
          </FieldHalf>
        </FieldRow>
        <FieldRow>
          <FieldHalf>
            <PillInput placeholder="Unit" value={form.unit} onChangeText={setField('unit')} />
          </FieldHalf>
          <FieldHalf>
            <PillInput
              placeholder="Price"
              value={form.price}
              onChangeText={setField('price')}
              keyboardType="numeric"
            />
          </FieldHalf>
        </FieldRow>

        <PillInput
          placeholder="Description"
          value={form.description}
          onChangeText={setField('description')}
          multiline
          numberOfLines={4}
          style={{ minHeight: 90, borderRadius: 12, textAlignVertical: 'top' }}
        />

        <FieldRow>
          <FieldHalf>
            <PillInput
              placeholder="Image URL"
              value={form.imageUrl}
              onChangeText={setField('imageUrl')}
            />
          </FieldHalf>
          <FieldHalf>
            <ActionButton label="Stock level" onPress={() => {}} />
          </FieldHalf>
        </FieldRow>
      </Card>

      <Card>
        <CardHeading
          title="Bulk price update"
          subtitle="Paste a price list or upload a .csv file to set all prices in one go. Format: Product Name,Price per line (header row optional)."
          action={<ActionButton label="Download CSV" size="small" onPress={() => {}} />}
        />

        <PillInput
          value={bulkText}
          onChangeText={setBulkText}
          multiline
          numberOfLines={4}
          style={{ minHeight: 90, borderRadius: 12, textAlignVertical: 'top' }}
        />

        <ButtonRow>
          <ActionButton
            label="Upload csv"
            variant="primary"
            onPress={() => {}}
            style={{ marginRight: 8 }}
          />
          <ActionButton label="Parse preview" onPress={() => {}} style={{ marginRight: 8 }} />
          <ActionButton label="Apply prices" onPress={() => {}} />
        </ButtonRow>
      </Card>

      <Card>
        <CardHeading title="Locations" />
        <PillInput
          placeholder="Search"
          value={locationSearch}
          onChangeText={setLocationSearch}
        />
        <DataTable
          columns={['Photo', 'Name', 'Category', 'Unit Measurement', 'Price', 'Brand', 'Actions']}
          rows={[]}
        />
      </Card>
    </View>
  );
}