/** Remove a credential from any diagnostic text before it reaches UI or logs. */
export function redactCredential(text: string, credential: string | undefined): string {
	if (!credential) return text;
	const replacement = credential.startsWith("rart_")
		? "rart_…" + credential.slice(-4)
		: "[credential redacted]";
	return text.split(credential).join(replacement);
}
