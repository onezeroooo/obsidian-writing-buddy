/**
 * Frozen fingerprints for every built-in Markdown file shipped through 0.4.1.
 *
 * Older WritingBuddy releases materialised these files in the Vault.  A file
 * is a mirror only when its exact UTF-8 bytes match one of these records; an
 * edited file must remain writer-owned even when its `id` and `version` still
 * look like a built-in.  The catalogue is deliberately data, not generated
 * from today's built-ins, because both prompt text and the serializer evolve.
 */

export interface HistoricalBuiltinRecord {
	id: string;
	version: number;
	contentHash: string;
	releases: readonly string[];
}

const EARLY_RELEASES = ["0.1.0", "0.2.0", "0.3.0"] as const;
const LATE_RELEASES = ["0.4.0", "0.4.1"] as const;
const ALL_RELEASES = [...EARLY_RELEASES, ...LATE_RELEASES] as const;

export const HISTORICAL_BUILTIN_CATALOG: readonly HistoricalBuiltinRecord[] = [
	record("ask-selection", 3, "5b1046d8c37f267062c5038d0d97d2765f81f7ae47b4c8a841e689defe97c92d", ["0.1.0", "0.2.0", "0.3.0", "0.4.0"]),
	record("ask-selection", 3, "da44c40189158ea369b4098252a6a3bfe49fde4609dc991dde1426679ae55d45", ["0.4.1"]),
	record("ask-selection", 3, "3ed3a459195df09a3ac050c0193aaf720a4b3e8da90c4a4facdd7745a40a1576", ["0.4.1-public-fixture"]),
	record("rewrite", 3, "81f4e80e4c905ae6cc70fabd0985fa90066a1f2c8cb72d6c3c928bc3886f8492", EARLY_RELEASES),
	record("rewrite", 3, "bde1de92418fc211fd47ba743668f5e97aed15bf0c212ba78f1ef58282e789ae", ["0.3.0-public-fixture"]),
	record("rewrite", 3, "75e748d64425e65cb1952b086d6ebd7cfb0e2a77c5dfcf042dff797c9ac5df93", LATE_RELEASES),
	record("polish", 3, "6d9d6bb92c55edec6209081cf9fe442cf1702e75697df023515638f5f222fa90", EARLY_RELEASES),
	record("polish", 3, "dd298dd066bcbb35972a8e2c3b0e659042594c8dc0ee904bfb70306bd4dd834f", ["0.3.0-public-fixture"]),
	record("polish", 3, "95dd83059cbdb7b0f098375d05b398ac647d0a6a3672f58a54f8d3bc033a5dd3", LATE_RELEASES),
	record("shorten", 3, "e51ca729aa4594ed54c09973ba96c3aa0af9fb3fdd5fcfc3f3b7de8e979b126e", EARLY_RELEASES),
	record("shorten", 3, "385cb5dfff0dab5de9969495b2a6aa069631a02839e76eaa2fb7f83defd60617", ["0.3.0-public-fixture"]),
	record("shorten", 3, "451756634c7a1da20b8d86e50794e126ade82ab2532757fc6144d6331fbc34e3", LATE_RELEASES),
	record("expand", 3, "d171418b4e49b69e49182be28c173caec2ad1607c7c2e4006a95fe3042aae6f8", EARLY_RELEASES),
	record("expand", 3, "a16e2cadc8df174455d44b98693cb58162931f2585718fee1ee014aedd6bd9bc", ["0.3.0-public-fixture"]),
	record("expand", 3, "20396f9acbb18222fe5bad3834ad57c556c58d3ce06a38774bddf9249d5f242e", LATE_RELEASES),
	record("continue", 3, "90b66efef75d4538945d0c25805d394a3ea3ba21f9c5d2f3dd2199ab467b4510", EARLY_RELEASES),
	record("continue", 3, "3d63c204cf29ee9fdad23b05f3655e854a0206446df6b71bfdcacf960468e036", ["0.3.0-public-fixture"]),
	record("continue", 3, "e491f5de53f892a6f520365566dc7df41f7eef7f556a3cf3034efeb40dc38501", LATE_RELEASES),
	record("show-not-tell", 1, "6811f2ccab28eb4f66fe37c8f0109bcc9ad1f82fea95bf4cc0f61abb5e365758", EARLY_RELEASES),
	record("show-not-tell", 1, "9841a4f401ce674c6235487cb6750d0230049fe69d62766978acf012ddc5bd8b", ["0.3.0-public-fixture"]),
	record("show-not-tell", 1, "390334b950160a74f9083c73550719c94536799738ede1e3acb2dc8fed18aaf1", LATE_RELEASES),
	record("dialogue", 1, "05880e132c0c6183d56152aac940d0db758218194d43aa5e22ad28231fb5321a", EARLY_RELEASES),
	record("dialogue", 1, "c7b6bb64f9bb4e373ab2fafbf1206f15b3368e5872a2177b04581acbab13bf7b", ["0.3.0-public-fixture"]),
	record("dialogue", 1, "40b38a64e5ad0bfb7511a2691a14b52dd35d1a42cf8ed0ce213e6b4b64753710", LATE_RELEASES),
	record("transition", 1, "6c531bd09ccb9a8759701b3d2c0be661166f8063d0fad3bc254358fa81338067", EARLY_RELEASES),
	record("transition", 1, "47fc7f59862c833621ecbc46445f644244882c08e883d4943c1876b22370577e", ["0.3.0-public-fixture"]),
	record("transition", 1, "dbf526644213bf31b0316482840c3863e5ac9b6063943cb770f81cdbbf8ac73a", LATE_RELEASES),
	record("character-consistency", 3, "020573bc1ca652b9c6c98fa9172bcabb5d5d78c054ea3226d76074a77ba770ca", ALL_RELEASES),
	record("pacing", 1, "91a51a674fcdf308d83af840126ea05f85f1ab786d5004ebbd29b8a48818b359", ALL_RELEASES),
	record("continuity", 1, "33639891cfb940caf0fa34f12fe65f46c9d3367d73979f792180a4cc8bc294df", ALL_RELEASES),
	record("foreshadow", 1, "06e8319712d2db94a70c57b9a6aeba8a00535011dcce1546a25ddf09de60a85d", ALL_RELEASES),
	record("chapter-summary", 1, "6637581d3e36f1f1ab39d821af1fc4b2a8506fd8624bce2a72186936a2208634", ALL_RELEASES),
] as const;

/**
 * Frozen source snapshots for the two historical prompt families that are no
 * longer derivable from today's built-in objects. They are intentionally
 * literal: migration must recognise what an old release actually wrote.
 */
const HISTORICAL_PASSAGE_PROTOCOL = [
	"",
	"回复方式：",
	"1. 先像一位合作的编辑那样把话说完整：你做了什么、为什么这样处理、有哪些取舍，",
	"   必要时也可以指出你认为不该动的地方。不要只丢结果。",
	"2. 然后把**完整的**成稿放进一个 ```改写后 代码块里。",
	"3. 代码块里只放正文，不要解释、标题或引号；块外的话不会写进稿子。",
	"4. 如果要分别改动好几处，就每一处先用 ```原文 代码块原样引出要替换的句子，",
	"   紧接着给出它的 ```改写后 代码块。引用的原文必须和稿子里的文字完全一致。",
	"5. 如果你认为不该改，就说明理由，并且不要给出代码块。",
	"",
	"引用方式：附上的每份资料都带编号（[S1]、[S2]…）。",
	"当某个判断确实来自其中一份时，把编号写在那句话后面，例如：林昭一向不解释自己。[S2]",
	"一句话有多个依据就连写：[S2][S5]。",
	"编号要紧跟它支持的那句话，不要把出处堆在结尾；也不要编造编号或在正文里写文件路径。",
	"编号只出现在你的说明里：写给稿子的正文一个编号都不要带，那是要贴进小说里的文字。",
].join("\n");

const PLAIN_PASSAGE_PROTOCOL = [
	"", "回复方式：", "只返回可替换所选正文的完整候选文本。",
	"不要解释，不要加标题、引号、Markdown 代码围栏或引用编号。",
	"选区前后文、当前章节和其他资料只供理解，不能扩大可修改范围。",
].join("\n");

interface HistoricalTemplate {
	id: string; name: string; action: "rewrite" | "continue"; version: number;
	description: string; triggers: readonly string[]; prefix: readonly string[];
}

const PASSAGE_TEMPLATES: readonly HistoricalTemplate[] = [
	{ id: "rewrite", name: "改写", action: "rewrite", version: 3, description: "按你的说明改写选区。", triggers: ["改写", "重写", "换个写法", "改一下"], prefix: ["按照作者给出的说明改写所选正文。", "", "保持人物称谓和既有设定不变，除非作者明确要求改动。"] },
	{ id: "polish", name: "润色", action: "rewrite", version: 3, description: "保持剧情不变，优化语言与节奏。", triggers: ["润色", "打磨", "改得更好", "语言优化"], prefix: ["润色所选正文。", "", "保留剧情、人物行为和信息点不变。", "优化语言、节奏、衔接和表达。", "不要增加新的情节，也不要删除已有的信息点。"] },
	{ id: "shorten", name: "精简", action: "rewrite", version: 3, description: "压缩篇幅，保留全部信息点。", triggers: ["精简", "压缩", "收紧", "太啰嗦", "删减", "短一点"], prefix: ["精简所选正文。", "", "在明显缩短篇幅的同时保留全部关键信息点和人物行为。", "优先删去重复的描写、冗余的修饰和不承担作用的过渡句。"] },
	{ id: "expand", name: "扩写", action: "rewrite", version: 3, description: "在既有情节内补充细节。", triggers: ["扩写", "展开", "写细一点", "太简略", "补充细节"], prefix: ["扩写所选正文。", "", "在不改变既有情节走向的前提下补充细节、感官描写和人物反应。", "不要引入新的人物、地点或设定。"] },
	{ id: "continue", name: "续写", action: "continue", version: 3, description: "顺着当前段落往下写。", triggers: ["续写", "接着写", "往下写", "接下去", "后面加", "再加点", "补点", "加点对话"], prefix: ["顺着所选正文继续往下写。", "", "保持叙述人称、时态、语气和节奏与前文一致。", "续写内容要能直接接在所选正文之后。"] },
	{ id: "show-not-tell", name: "改成动作", action: "rewrite", version: 1, description: "把直白的情绪说明换成动作、细节和留白。", triggers: ["少解释", "改成动作", "别写心理", "太直白", "show not tell"], prefix: ["把所选正文里直接说明情绪和心理的地方，改成用动作、细节、环境或留白来承担。", "", "能用动作写的就不要写心理，能不解释的就不解释。", "不要增加新的情节，也不要改变人物已经做出的行为。", "如果某处确实需要直接点明，说明为什么，并保留它。"] },
	{ id: "dialogue", name: "对白打磨", action: "rewrite", version: 1, description: "让每个人的话听起来像他自己说的。", triggers: ["对白打磨", "打磨对白", "对白不像", "台词生硬", "说话不像", "对白改一改"], prefix: ["打磨所选正文里的对白。", "", "让每个人的用词、句长和语气符合他自己的身份、性格和当下处境，", "不同人物的说话方式要能听出区别。", "删掉为了交代信息而存在的台词，改用行动、停顿或不说来处理。", "对白之间的动作和神态描写要克制，不要每句都配一个提示语。", "不要改变人物说了什么事实，只改他怎么说。"] },
	{ id: "transition", name: "衔接过渡", action: "rewrite", version: 1, description: "把跳跃的段落接顺，或把拖沓的过渡收掉。", triggers: ["衔接", "过渡", "太跳", "接不上", "转场"], prefix: ["处理所选正文的衔接。", "", "如果段落之间跳得太急，补上必要的时间、地点或视角交代，但只补最少的量。", "如果过渡拖沓，就压缩或直接删掉，让场景自己接上。", "保留全部情节和信息点，不要引入新的事件。"] },
];

/** Exact old seed bytes used by migration fixtures and compatibility checks. */
export function historicalSeedSource(id: string, release: "0.3.0" | "0.4.0"): string | undefined {
	const template = PASSAGE_TEMPLATES.find((candidate) => candidate.id === id);
	if (!template) return undefined;
	const prefix = [...template.prefix];
	if (id === "continue") prefix.push(release === "0.3.0"
		? "代码块里只放新写的部分，不要重复已有正文。"
		: "只返回新写的部分，不要重复已有正文。");
	const protocol = release === "0.3.0" ? HISTORICAL_PASSAGE_PROTOCOL : PLAIN_PASSAGE_PROTOCOL;
	return [
		"---", `id: ${template.id}`, `name: ${template.name}`, `action: ${template.action}`,
		"scope: selection", `version: ${template.version}`, `description: ${template.description}`,
		`triggers: ${template.triggers.join("、")}`, "---", "", [...prefix, protocol].join("\n"), "",
	].join("\n");
}

/**
 * Return a frozen known hash when only parser-equivalent representation differs.
 *
 * This deliberately compares the complete frontmatter key set.  In particular,
 * metadata introduced after the historical seed was written (or a writer's own
 * unknown annotation) is evidence that the file is writer-owned, even when the
 * old instruction body is unchanged.
 */
export function findCanonicalHistoricalBuiltin(id: string, source: string): HistoricalBuiltinRecord | undefined {
	const parsed = parseHistoricalSkill(source, id);
	if (!parsed) return undefined;
	for (const release of ["0.3.0", "0.4.0"] as const) {
		const candidate = historicalSeedSource(id, release);
		if (!candidate) continue;
		const known = parseHistoricalSkill(candidate, id);
		if (!known || !sameHistoricalSemantics(parsed, known)) continue;
		return findHistoricalBuiltin(id, hashSkillSource(candidate));
	}
	return undefined;
}

interface HistoricalSemantics {
	id: string; name: string; action: string; scope: string; version: number;
	description: string; triggers: string[]; instruction: string;
	frontmatterKeys: string[];
}

function parseHistoricalSkill(source: string, fallbackId: string): HistoricalSemantics | undefined {
	const text = source.replace(/^﻿/u, "");
	const match = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(text);
	if (!match) return undefined;
	const fields = new Map<string, string>();
	for (const raw of (match[1] ?? "").split(/\r?\n/u)) {
		if (raw.trim().length === 0) continue;
		const separator = raw.indexOf(":");
		// Historical seeds contain only flat key/value fields.  Do not silently
		// discard comments, malformed lines, duplicate keys, or new metadata.
		if (separator <= 0) return undefined;
		const key = raw.slice(0, separator).trim().toLowerCase();
		if (key.length === 0 || fields.has(key)) return undefined;
		let value = raw.slice(separator + 1).trim();
		if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
			value = value.slice(1, -1);
		}
		fields.set(key, value);
	}
	const id = fields.get("id") ?? fallbackId;
	const action = fields.get("action");
	const versionText = fields.get("version") ?? "1";
	if (!action || !/^[1-9][0-9]*$/u.test(versionText)) return undefined;
	const version = Number(versionText);
	if (!Number.isSafeInteger(version)) return undefined;
	return {
		id, name: fields.get("name") ?? id, action, scope: fields.get("scope") ?? "selection",
		version,
		description: fields.get("description") ?? "",
		triggers: (fields.get("triggers") ?? "").split(/[、,，;；|]/u).map((item) => item.trim()).filter(Boolean),
		instruction: text.slice(match[0].length).replace(/\r\n?/gu, "\n").trim(),
		frontmatterKeys: [...fields.keys()].sort(),
	};
}

function sameHistoricalSemantics(left: HistoricalSemantics, right: HistoricalSemantics): boolean {
	return left.id === right.id && left.name === right.name && left.action === right.action &&
		left.scope === right.scope && left.version === right.version && left.description === right.description &&
		JSON.stringify(left.triggers) === JSON.stringify(right.triggers) && left.instruction === right.instruction &&
		JSON.stringify(left.frontmatterKeys) === JSON.stringify(right.frontmatterKeys);
}

const byIdAndHash = new Map(
	HISTORICAL_BUILTIN_CATALOG.map((entry) => [`${entry.id}:${entry.contentHash}`, entry]),
);
const historicalIds = new Set(HISTORICAL_BUILTIN_CATALOG.map((entry) => entry.id));

export function findHistoricalBuiltin(id: string, contentHash: string): HistoricalBuiltinRecord | undefined {
	return byIdAndHash.get(`${id}:${contentHash}`);
}

export function isHistoricalBuiltinId(id: string): boolean {
	return historicalIds.has(id);
}

function record(
	id: string,
	version: number,
	contentHash: string,
	releases: readonly string[],
): HistoricalBuiltinRecord {
	return { id, version, contentHash, releases };
}

/** SHA-256 over the exact UTF-8 bytes persisted in the Vault. */
export function hashSkillSource(source: string): string {
	const bytes = new TextEncoder().encode(source);
	const words = new Uint32Array(64);
	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
		0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const bitLength = bytes.length * 8;
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);

	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let index = 0; index < 16; index += 1) {
			words[index] = view.getUint32(offset + index * 4, false);
		}
		for (let index = 16; index < 64; index += 1) {
			const a = words[index - 15] ?? 0;
			const b = words[index - 2] ?? 0;
			const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
			const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
			words[index] = add(words[index - 16] ?? 0, s0, words[index - 7] ?? 0, s1);
		}

		let [a, b, c, d, e, f, g, h] = hash;
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choose = (e & f) ^ (~e & g);
			const temp1 = add(h, sum1, choose, SHA256_CONSTANTS[index] ?? 0, words[index] ?? 0);
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = add(sum0, majority);
			h = g; g = f; f = e; e = add(d, temp1); d = c; c = b; b = a; a = add(temp1, temp2);
		}
		hash[0] = add(hash[0] ?? 0, a); hash[1] = add(hash[1] ?? 0, b);
		hash[2] = add(hash[2] ?? 0, c); hash[3] = add(hash[3] ?? 0, d);
		hash[4] = add(hash[4] ?? 0, e); hash[5] = add(hash[5] ?? 0, f);
		hash[6] = add(hash[6] ?? 0, g); hash[7] = add(hash[7] ?? 0, h);
	}

	return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, amount: number): number {
	return (value >>> amount) | (value << (32 - amount));
}

function add(...values: number[]): number {
	let sum = 0;
	for (const value of values) sum = (sum + value) >>> 0;
	return sum;
}

const SHA256_CONSTANTS = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
