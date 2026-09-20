import { Switch } from "./switch";

// Preserve the settings API while Base UI owns switch interaction and state.
export function SettingSwitch({
	label,
	checked,
	disabled = false,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<Switch
			aria-label={label}
			checked={checked}
			disabled={disabled}
			onCheckedChange={onChange}
		/>
	);
}
