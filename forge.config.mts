import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 * SmartSpectra native runtime, one block per target OS.
 *
 * The SDK resolves its native closure (libsmartspectra_capi + bundled libs)
 * from `@smartspectra/node-sdk-<plat>-<arch>`. A shared library cannot be
 * dlopen'd from inside app.asar, so the platform package ships as an extra
 * resource (Contents/Resources/node-sdk-<plat>-<arch>/ on macOS) and
 * src/main/sdkBridge.ts points SMARTSPECTRA_CAPI_PATH at it when packaged.
 *
 * Forge evaluates this file on the BUILD HOST, so these blocks are correct for
 * native builds only (build the mac app on a Mac). Cross-builds are refused in
 * the packageAfterCopy hook below.
 */
const NATIVE_RUNTIME_EXTRA_RESOURCE: Record<string, string[]> = {
  // macOS (Apple Silicon is the only published mac runtime).
  darwin: ['node_modules/@smartspectra/node-sdk-darwin-arm64'],
  win32: ['node_modules/@smartspectra/node-sdk-win32-x64'],
  linux: [`node_modules/@smartspectra/node-sdk-linux-${process.arch}`],
};

/** Runtime JS deps that the Vite main bundle keeps external (see vite.main.config.mts). */
const EXTERNAL_ROOTS = ['@smartspectra/node-sdk'];

/** Walk package.json dependencies from the external roots, skipping native platform payloads. */
async function externalClosure(root: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...EXTERNAL_ROOTS];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name) || /^@smartspectra\/node-sdk-/.test(name)) continue;
    const pkgJson = path.join(root, 'node_modules', name, 'package.json');
    if (!existsSync(pkgJson)) continue;
    seen.add(name);
    const pkg = JSON.parse(await fs.readFile(pkgJson, 'utf8')) as { dependencies?: Record<string, string> };
    queue.push(...Object.keys(pkg.dependencies ?? {}));
  }
  return [...seen];
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Composure',
    executableName: 'composure',
    appBundleId: 'dev.composure.app',
    appCategoryType: 'public.app-category.education',
    extraResource: NATIVE_RUNTIME_EXTRA_RESOURCE[process.platform] ?? [],
    extendInfo: {
      NSCameraUsageDescription:
        'Composure uses the camera to measure breathing, pulse, and talking on this Mac during a rehearsal. Video is processed in memory and never stored.',
    },
    // Code signing is opt-in: set COMPOSURE_SIGN_IDENTITY to a Developer ID to
    // sign with hardened runtime and the camera + library-validation
    // entitlements in build/entitlements.mac.plist.
    ...(process.env.COMPOSURE_SIGN_IDENTITY
      ? {
          osxSign: {
            identity: process.env.COMPOSURE_SIGN_IDENTITY,
            optionsForFile: () => ({
              hardenedRuntime: true,
              entitlements: 'build/entitlements.mac.plist',
            }),
          },
        }
      : {}),
  },
  rebuildConfig: {},
  hooks: {
    // The Vite plugin packages only the bundled .vite output. Copy the
    // externalized SDK JS (and its pure-JS deps: koffi, protobufjs, ...) into
    // the app so `require('@smartspectra/node-sdk/main')` resolves at runtime.
    packageAfterCopy: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const runtimeArch: Record<string, string> = { darwin: 'arm64', win32: 'x64', linux: process.arch };
      if (platform !== process.platform || arch !== runtimeArch[platform] || arch !== process.arch) {
        throw new Error(
          `Composure packaging is native-only: build ${platform}-${arch} on a matching ${platform}-${arch} host ` +
            `(SmartSpectra publishes darwin-arm64, win32-x64, linux-x64, linux-arm64 runtimes).`,
        );
      }
      const root = process.cwd();
      for (const name of await externalClosure(root)) {
        const from = path.join(root, 'node_modules', name);
        const to = path.join(buildPath, 'node_modules', name);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.cp(from, to, { recursive: true, dereference: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
