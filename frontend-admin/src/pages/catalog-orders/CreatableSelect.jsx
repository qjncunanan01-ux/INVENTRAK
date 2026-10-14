import { Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { colors } from '../../theme';

const filter = createFilterOptions();

// Free-text-yet-creatable select used by the product form (category, brand,
// unit): pick an existing option, or type a new one and it is offered as
// "Add \"…\" as new". Extracted from ProductsPage so the form panel stays
// presentational.
export default function CreatableSelect({ label, value, onChange, options, placeholder }) {
  return (
    <Autocomplete
      value={value || ''}
      onChange={(event, newValue) => {
        if (typeof newValue === 'string') {
          onChange(newValue);
        } else if (newValue && newValue.inputValue) {
          onChange(newValue.inputValue);
        } else {
          onChange(newValue || '');
        }
      }}
      onInputChange={(event, newInputValue, reason) => {
        if (reason !== 'reset') {
          onChange(newInputValue);
        }
      }}
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params);
        const { inputValue } = params;
        const trimmed = inputValue.trim();
        const isExisting = opts.some((option) => trimmed.toLowerCase() === option.toLowerCase());
        if (trimmed !== '' && !isExisting) {
          filtered.push({
            inputValue: trimmed,
            title: `Add "${trimmed}" as new`,
          });
        }
        return filtered;
      }}
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      options={options}
      getOptionLabel={(option) => {
        if (typeof option === 'string') return option;
        if (option.inputValue) return option.inputValue;
        return option.title || '';
      }}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        if (typeof option === 'object' && option.inputValue) {
          return (
            <li key={key} {...optionProps} style={{ fontWeight: 'bold', color: colors.primary }}>
              {option.title}
            </li>
          );
        }
        return (
          <li key={key} {...optionProps}>
            {option}
          </li>
        );
      }}
      freeSolo
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} variant="outlined" fullWidth />
      )}
    />
  );
}
