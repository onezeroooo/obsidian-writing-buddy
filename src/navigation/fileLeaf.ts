/**
 * Decide which workspace leaf should show a file, without knowing anything
 * about Obsidian. Keeping this policy here makes the important distinction
 * explicit: an already-open file is activated, while a closed file gets a new
 * tab and never replaces the writer's current leaf.
 */

export interface FileLeafActions<Leaf> {
	pathOf: (leaf: Leaf) => string | null;
	createTab: () => Leaf;
	reveal: (leaf: Leaf) => Promise<void>;
	open: (leaf: Leaf) => Promise<void>;
	activate: (leaf: Leaf) => void;
}

/** Find any already-open leaf whose file path exactly matches `filePath`. */
export function findOpenFileLeaf<Leaf>(
	leaves: readonly Leaf[],
	filePath: string,
	pathOf: (leaf: Leaf) => string | null,
): Leaf | null {
	return leaves.find((leaf) => pathOf(leaf) === filePath) ?? null;
}

/**
 * Activate the existing leaf for a file, or open the file in a newly-created
 * tab when no such leaf exists. The callbacks keep workspace effects at the
 * edge while making the navigation contract directly testable.
 */
export async function activateOrOpenFileLeaf<Leaf>(
	leaves: readonly Leaf[],
	filePath: string,
	actions: FileLeafActions<Leaf>,
): Promise<Leaf> {
	const existing = findOpenFileLeaf(leaves, filePath, actions.pathOf);
	const leaf = existing ?? actions.createTab();

	if (existing) {
		await actions.reveal(existing);
	} else {
		await actions.open(leaf);
	}
	actions.activate(leaf);
	return leaf;
}
