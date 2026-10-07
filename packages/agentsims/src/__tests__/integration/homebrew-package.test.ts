import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	generateFormula,
	parseReleaseMetadata,
	releaseChecksums,
	type ReleaseMetadata,
} from "../../../scripts/prepare-release";
import {
	HOMEBREW_TARGETS,
	RUNTIME_TARGETS,
	runtimeArchiveName,
	runtimeArtifacts,
	type RuntimeTarget,
} from "../../../scripts/release-targets";

const ruby = Bun.which("ruby");
if (!ruby)
	throw new Error(
		"The formula tests need Ruby for local syntax and layout checks.",
	);
const rubyExecutable = ruby;
let directory: string;
let formulaPath: string;

function metadata(): ReleaseMetadata {
	return {
		schemaVersion: 1,
		version: "1.2.3",
		repository: "Maniktherana/agentsims",
		artifacts: Object.fromEntries(
			RUNTIME_TARGETS.map((target, index) => [
				target,
				{
					file: runtimeArchiveName(target),
					sha256: String(index + 1).repeat(64),
				},
			]),
		) as ReleaseMetadata["artifacts"],
	};
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "agentsims homebrew package "));
	formulaPath = join(directory, "agentsims.rb");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

// This harness executes the generated Ruby. It does not use Homebrew or change its state.
const harness = `require "fileutils"
require "json"
require "pathname"
require "shellwords"

module OS
  def self.mac?; ENV.fetch("FIXTURE_OS") == "darwin"; end
  def self.linux?; ENV.fetch("FIXTURE_OS") == "linux"; end
end
module Hardware
  module CPU
    def self.arm?; ["arm64", "arm"].include?(ENV.fetch("FIXTURE_ARCH")); end
    def self.intel?; ["x64", "x86"].include?(ENV.fetch("FIXTURE_ARCH")); end
  end
end
class FixturePath < Pathname
  def /(part); self.class.new(File.join(to_s, part.to_s)); end
  def install(*sources)
    FileUtils.mkdir_p(to_s)
    sources.each { |source| FileUtils.mv(source, (self / File.basename(source)).to_s) }
  end
  def write_exec_script(*targets)
    FileUtils.mkdir_p(to_s)
    targets.each do |target|
      path = self / target.basename
      File.write(path, "#!/bin/sh\\nexec " + Shellwords.escape(target.to_s) + ' "$@"' + "\\n")
      File.chmod(0755, path)
    end
  end
end
class Formula
  def self.config; @config ||= {dependencies: []}; end
  def self.desc(_value); end
  def self.homepage(value); config[:homepage] = value; end
  def self.license(_value); end
  def self.version(value); config[:version] = value; end
  def self.url(value); config[:url] = value; end
  def self.sha256(value); config[:sha256] = value; end
  def self.depends_on(value); config[:dependencies] << value; end
  def self.on_macos(&block); class_eval(&block) if OS.mac?; end
  def self.on_linux(&block); class_eval(&block) if OS.linux?; end
  def self.on_arm(&block); class_eval(&block) if Hardware::CPU.arm?; end
  def self.on_intel(&block); class_eval(&block) if Hardware::CPU.intel?; end
  def self.test(&block); config[:test] = block; end
  def version; self.class.config.fetch(:version); end
  def prefix; FixturePath.new(ENV.fetch("FIXTURE_PREFIX")); end
  def libexec; prefix / "libexec"; end
  def bin; prefix / "bin"; end
  def odie(message); raise message; end
  def shell_output(command)
    output = IO.popen(command, &:read)
    raise "The formula test command failed." unless $?.success?
    output
  end
  def assert_equal(expected, actual); raise "The formula test version differs." unless expected == actual; end
end
load ARGV.fetch(0)
formula = Agentsims.new
begin
  expected_arch = {"arm64" => "arm64", "x64" => "x86_64"}[ENV.fetch("FIXTURE_ARCH")]
  Agentsims.config[:dependencies].each do |dependency|
    if dependency[:arch] && dependency[:arch].to_s != expected_arch
      raise "The formula requires architecture #{dependency[:arch]}."
    end
  end
  formula.install
  formula.instance_eval(&Agentsims.config[:test])
  puts JSON.generate(Agentsims.config.reject { |key, _value| key == :test })
rescue => error
  warn error.message
  exit 1
end
`;

function runFormula(target: string, missing?: string) {
	const source = join(directory, "extracted");
	const prefix = join(directory, "installed runtime");
	mkdirSync(source);
	if (RUNTIME_TARGETS.includes(target as RuntimeTarget)) {
		const files = [
			"LICENSE",
			...runtimeArtifacts(target as RuntimeTarget).map(
				(artifact) =>
					`dist/${artifact === "preview" ? "preview/index.html" : artifact}`,
			),
			"dist/preview/assets/workspace.js",
			"dist/preview/assets/workspace.css",
		];
		for (const file of files) {
			if (file === missing) continue;
			const path = join(source, file);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(
				path,
				file === "dist/agentsims"
					? "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '1.2.3\\n'; else printf '<%s>\\n' \"$@\"; fi\n"
					: `${target}: ${file}\n`,
				{ mode: 0o755 },
			);
		}
	}
	writeFileSync(formulaPath, generateFormula(metadata()));
	const harnessPath = join(directory, "formula-harness.rb");
	writeFileSync(harnessPath, harness);
	const [os, arch] = target.split("-");
	const result = spawnSync(rubyExecutable, [harnessPath, formulaPath], {
		cwd: source,
		encoding: "utf8",
		timeout: 5000,
		env: {
			...process.env,
			FIXTURE_OS: os,
			FIXTURE_ARCH: arch,
			FIXTURE_PREFIX: prefix,
		},
	});
	return { result, source, prefix };
}

test("generated release formula has valid Ruby syntax", () => {
	writeFileSync(formulaPath, generateFormula(metadata()));
	const result = spawnSync(rubyExecutable, ["-c", formulaPath], {
		encoding: "utf8",
		timeout: 5000,
	});
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe("Syntax OK");
});

test.each([...HOMEBREW_TARGETS])(
	"the %s formula selects exact metadata and installs all assets",
	(target) => {
		const { result, prefix } = runFormula(target);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		const configuration = JSON.parse(result.stdout);
		const release = metadata();
		expect(configuration.version).toBe(release.version);
		expect(configuration.url).toBe(
			`https://github.com/${release.repository}/releases/download/v${release.version}/${release.artifacts[target].file}`,
		);
		expect(configuration.sha256).toBe(release.artifacts[target].sha256);
		expect(configuration.dependencies).toEqual([
			{ arch: target === "darwin-arm64" ? "arm64" : "x86_64" },
		]);
		expect(readdirSync(join(prefix, "bin"))).toEqual(["agentsims"]);
		for (const file of [
			"LICENSE",
			...runtimeArtifacts(target).map(
				(artifact) =>
					`dist/${artifact === "preview" ? "preview/index.html" : artifact}`,
			),
			"dist/preview/assets/workspace.js",
			"dist/preview/assets/workspace.css",
		]) {
			if (file !== "dist/agentsims")
				expect(readFileSync(join(prefix, "libexec", file), "utf8")).toBe(
					`${target}: ${file}\n`,
				);
		}
		const command = spawnSync(
			join(prefix, "bin/agentsims"),
			["path with spaces", "$literal"],
			{ encoding: "utf8" },
		);
		expect(command.status).toBe(0);
		expect(command.stdout).toBe("<path with spaces>\n<$literal>\n");
	},
);

test.each([
	"linux-arm64",
	"linux-x86",
	"darwin-x86",
	"darwin-ppc",
	"windows-x64",
])("%s cannot install an unsupported runtime", (target) => {
	const { result } = runFormula(target);
	expect(result.status).toBe(1);
	expect(result.stderr).toMatch(
		/requires architecture|supports macOS arm64 and x86_64, or Linux x86_64/,
	);
	expect(readdirSync(directory)).not.toContain("installed runtime");
});

test.each([
	["darwin-arm64", "dist/native/agentsims-native.node"],
	["darwin-x64", "dist/simcam/libSimCameraInjector.dylib"],
	["darwin-arm64", "dist/simcam/agentsims-camera-helper"],
	["darwin-x64", "dist/simax/agentsims-ax-settings"],
	["linux-x64", "dist/android/agentsims-ax-server.jar"],
	["linux-x64", "dist/preview/index.html"],
])(
	"%s installation fails before copying when %s is absent",
	(target, missing) => {
		const { result } = runFormula(target, missing);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`The release asset is missing: ${missing}`);
		expect(readdirSync(directory)).not.toContain("installed runtime");
	},
);

test("SHA256SUMS and formula selection use the same release metadata", () => {
	const release = parseReleaseMetadata(metadata());
	const lines = releaseChecksums(release).trim().split("\n");
	expect(lines).toHaveLength(RUNTIME_TARGETS.length);
	for (const [index, target] of RUNTIME_TARGETS.entries()) {
		expect(lines[index]).toBe(
			`${release.artifacts[target].sha256}  ${release.artifacts[target].file}`,
		);
	}
});

test.each(
	[
		undefined,
		null,
		[],
		{},
		{ ...metadata(), schemaVersion: 2 },
		{ ...metadata(), version: undefined },
		{ ...metadata(), version: "1.2" },
		{ ...metadata(), version: "latest" },
		{ ...metadata(), version: "1.2.3-beta.1" },
		{ ...metadata(), version: "01.2.3" },
		{ ...metadata(), repository: "owner/name#ruby" },
		{ ...metadata(), artifacts: {} },
	].map((input) => ({ input })),
)("incomplete or invalid release metadata %# is rejected", ({ input }) => {
	expect(() => generateFormula(input)).toThrow();
});

test.each([...RUNTIME_TARGETS])(
	"missing, renamed, or invalid %s checksums cannot generate a formula",
	(target) => {
		const missing = metadata();
		delete (missing.artifacts as Partial<ReleaseMetadata["artifacts"]>)[target];
		expect(() => generateFormula(missing)).toThrow(
			`Missing release artifact: ${target}.`,
		);
		const renamed = metadata();
		renamed.artifacts[target].file = "wrong-target.tar.gz";
		expect(() => generateFormula(renamed)).toThrow(
			"The release archive name is invalid",
		);
		for (const checksum of ["", "missing", "a".repeat(63), "A".repeat(64)]) {
			const input = metadata();
			input.artifacts[target].sha256 = checksum;
			expect(() => generateFormula(input)).toThrow(
				"The release checksum is invalid",
			);
		}
	},
);

test("metadata for an unsupported target is rejected", () => {
	const input = metadata();
	Object.assign(input.artifacts, {
		"linux-arm64": {
			file: "agentsims-linux-arm64.tar.gz",
			sha256: "a".repeat(64),
		},
	});
	expect(() => generateFormula(input)).toThrow(
		"Unsupported release target: linux-arm64.",
	);
});
