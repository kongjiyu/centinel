import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import './Select.css';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectGroup = {
  label: string;
  options: SelectOption[];
};

export type SelectProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-autofocus'?: boolean;
};

/**
 * The one select primitive used by the Centinel UI.
 *
 * Radix owns the combobox/listbox interaction model, focus handling and
 * portal, while this wrapper keeps values and form semantics consistent with
 * the rest of the app. The optional hidden input lets callers that submit a
 * native form retain the selected value without exposing a second control.
 */
export function Select({
  id,
  name,
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = 'Select an option',
  disabled = false,
  required = false,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'data-autofocus': dataAutofocus,
}: SelectProps) {
  const hasGroups = groups.length > 0;
  const items: ReactNode = hasGroups
    ? groups.map(group => (
        <RadixSelect.Group key={group.label}>
          <RadixSelect.Label className="select-group-label">{group.label}</RadixSelect.Label>
          {group.options.map(option => <SelectItem key={option.value} option={option} />)}
        </RadixSelect.Group>
      ))
    : options.map(option => <SelectItem key={option.value} option={option} />);

  return (
    <RadixSelect.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        className={`select-trigger ${className}`.trim()}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        data-autofocus={dataAutofocus || undefined}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="select-trigger-icon" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.8} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      {name && <input type="hidden" name={name} value={value} disabled={disabled} required={required} />}

      <RadixSelect.Portal>
        <RadixSelect.Content className="select-content" position="popper" sideOffset={4}>
          <RadixSelect.ScrollUpButton className="select-scroll-button" aria-hidden="true">
            <ChevronUp size={14} />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="select-viewport">{items}</RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="select-scroll-button" aria-hidden="true">
            <ChevronDown size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function SelectItem({ option }: { option: SelectOption }) {
  return (
    <RadixSelect.Item className="select-item" value={option.value} disabled={option.disabled}>
      <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="select-item-indicator">
        <Check size={15} strokeWidth={2} aria-hidden="true" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

