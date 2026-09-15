import type { ButtonComponent } from "obsidian";

/**
 * Marks a button as destructive. `setDestructive` arrived in Obsidian 1.13;
 * installs between `minAppVersion` and that release still get the warning
 * style it replaced.
 */
export function markDestructive(button: ButtonComponent): ButtonComponent {
	const modern = (button as { setDestructive?: () => ButtonComponent }).setDestructive;
	return typeof modern === "function" ? modern.call(button) : button.setWarning();
}
