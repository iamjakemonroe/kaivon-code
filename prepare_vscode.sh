#!/usr/bin/env bash
# shellcheck disable=SC1091,2154

set -e

cp -rp src/stable/* vscode/

cp -f LICENSE vscode/LICENSE.txt

cd vscode || { echo "'vscode' dir not found"; exit 1; }

{ set +x; } 2>/dev/null

# {{{ product.json
cp product.json{,.bak}

setpath() {
  local jsonTmp
  { set +x; } 2>/dev/null
  jsonTmp=$( jq --arg 'value' "${3}" "setpath(path(.${2}); \$value)" "${1}.json" )
  echo "${jsonTmp}" > "${1}.json"
  set -x
}

setpath_json() {
  local jsonTmp
  { set +x; } 2>/dev/null
  jsonTmp=$( jq --argjson 'value' "${3}" "setpath(path(.${2}); \$value)" "${1}.json" )
  echo "${jsonTmp}" > "${1}.json"
  set -x
}

setpath "product" "checksumFailMoreInfoUrl" "https://go.microsoft.com/fwlink/?LinkId=828886"
setpath "product" "documentationUrl" "https://go.microsoft.com/fwlink/?LinkID=533484#vscode"
setpath_json "product" "extensionsGallery" '{"serviceUrl": "https://open-vsx.org/vscode/gallery", "itemUrl": "https://open-vsx.org/vscode/item", "latestUrlTemplate": "https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest", "controlUrl": "https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json"}'

setpath "product" "introductoryVideosUrl" "https://go.microsoft.com/fwlink/?linkid=832146"
setpath "product" "keyboardShortcutsUrlLinux" "https://go.microsoft.com/fwlink/?linkid=832144"
setpath "product" "keyboardShortcutsUrlMac" "https://go.microsoft.com/fwlink/?linkid=832143"
setpath "product" "keyboardShortcutsUrlWin" "https://go.microsoft.com/fwlink/?linkid=832145"
setpath "product" "licenseUrl" "https://github.com/iamjakemonroe/kaivon-code/blob/main/LICENSE"
setpath_json "product" "linkProtectionTrustedDomains" '["https://open-vsx.org", "https://kaivon.app", "https://code.kaivon.app"]'
setpath "product" "releaseNotesUrl" "https://go.microsoft.com/fwlink/?LinkID=533483#vscode"
setpath "product" "reportIssueUrl" "https://github.com/iamjakemonroe/kaivon-code/issues/new"
setpath "product" "requestFeatureUrl" "https://go.microsoft.com/fwlink/?LinkID=533482"
setpath "product" "tipsAndTricksUrl" "https://go.microsoft.com/fwlink/?linkid=852118"
setpath "product" "twitterUrl" "https://go.microsoft.com/fwlink/?LinkID=533687"

# Updates are read from the `versions` branch once it exists; until then the check finds nothing.
if [[ "${DISABLE_UPDATE}" != "yes" ]]; then
  setpath "product" "updateUrl" "https://raw.githubusercontent.com/iamjakemonroe/kaivon-code/refs/heads/versions"
  setpath "product" "downloadUrl" "https://code.kaivon.app"
fi

setpath "product" "nameShort" "Kaivon Code"
setpath "product" "nameLong" "Kaivon Code"
setpath "product" "applicationName" "kaivon-code"
setpath "product" "dataFolderName" ".kaivon-code"
setpath "product" "sharedDataFolderName" ".kaivon-code-shared"
setpath "product" "linuxIconName" "kaivon-code"
setpath "product" "linuxDesktopName" "app.kaivon.Code"
setpath "product" "quality" "stable"
setpath "product" "urlProtocol" "kaivon-code"
setpath "product" "serverApplicationName" "kaivon-code-server"
setpath "product" "serverDataFolderName" ".kaivon-code-server"
setpath "product" "darwinBundleIdentifier" "app.kaivon.code"
setpath "product" "darwinProfileUUID" "05E15C00-86F4-4DD7-8B1A-399E51D672D4"
setpath "product" "darwinProfilePayloadUUID" "FA1E5E70-D25B-4ADB-A44F-4376C8E19EBC"
setpath "product" "win32AppUserModelId" "Kaivon.KaivonCode"
setpath "product" "win32DirName" "Kaivon Code"
setpath "product" "win32MutexName" "kaivoncode"
setpath "product" "win32NameVersion" "Kaivon Code"
setpath "product" "win32RegValueName" "KaivonCode"
setpath "product" "win32ShellNameShort" "Kaivon Code"
setpath "product" "win32AppId" "{{9A0C98AD-F8C2-411F-9070-6195364C23A1}"
setpath "product" "win32x64AppId" "{{8D994AB0-9BC9-44DF-924C-4BC0225C1EC0}"
setpath "product" "win32arm64AppId" "{{EA8EF323-0163-4EDA-9A7F-CCFFD20DD1D2}"
setpath "product" "win32UserAppId" "{{B8974DDE-D179-495C-90E5-1B2D8CFDB814}"
setpath "product" "win32x64UserAppId" "{{E0E48CEB-3965-408E-A264-0764AF0350A3}"
setpath "product" "win32arm64UserAppId" "{{D6CC3EC4-6051-4F5D-91D7-DFE721102F3D}"
setpath "product" "tunnelApplicationName" "kaivon-code-tunnel"
setpath "product" "win32TunnelServiceMutex" "kaivoncode-tunnelservice"
setpath "product" "win32TunnelMutex" "kaivoncode-tunnel"
setpath "product" "win32ContextMenu.x64.clsid" "73904B50-8958-4468-81C4-C9B7537F32CF"
setpath "product" "win32ContextMenu.arm64.clsid" "7A66E102-0B30-45A9-8906-0AEEF825C428"

setpath_json "product" "tunnelApplicationConfig" '{}'

jsonTmp=$( jq -s '.[0] * .[1]' product.json ../product.json )
echo "${jsonTmp}" > product.json && unset jsonTmp

cat product.json
# }}}

# include common functions
. ../utils.sh

# {{{ apply patches

echo "APP_NAME=\"${APP_NAME}\""
echo "DISPLAY_NAME=\"${DISPLAY_NAME}\""
echo "APP_NAME_LC=\"${APP_NAME_LC}\""
echo "ASSETS_REPOSITORY=\"${ASSETS_REPOSITORY}\""
echo "BINARY_NAME=\"${BINARY_NAME}\""
echo "GH_REPO_PATH=\"${GH_REPO_PATH}\""
echo "GLOBAL_DIRNAME=\"${GLOBAL_DIRNAME}\""
echo "ORG_NAME=\"${ORG_NAME}\""
echo "TUNNEL_APP_NAME=\"${TUNNEL_APP_NAME}\""

if [[ "${DISABLE_UPDATE}" == "yes" ]]; then
  apply_patch ../patches/00-update-disable.patch.yet
fi

for file in ../patches/*.json; do
  if [[ -f "${file}" ]]; then
    apply_actions "${file}"
  fi
done

for file in ../patches/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done

if [[ -d "../patches/${OS_NAME}/" ]]; then
  for file in "../patches/${OS_NAME}/"*.patch; do
    if [[ -f "${file}" ]]; then
      apply_patch "${file}"
    fi
  done
fi

for file in ../patches/user/*.patch; do
  if [[ -f "${file}" ]]; then
    apply_patch "${file}"
  fi
done
# }}}

# what makes it Kaivon Code
node ../kaivon/apply.mjs

set -x

# {{{ install dependencies
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if [[ "${OS_NAME}" == "linux" ]]; then
  export VSCODE_SKIP_NODE_VERSION_CHECK=1

  if [[ "${npm_config_arch}" == "arm" ]]; then
    export npm_config_arm_version=7
  fi
elif [[ "${OS_NAME}" == "windows" ]]; then
  if [[ "${npm_config_arch}" == "arm" ]]; then
    export npm_config_arm_version=7
  fi
else
  if [[ "${CI_BUILD}" != "no" ]]; then
    clang++ --version
  fi
fi

node build/npm/preinstall.ts

for i in {1..5}; do # try 5 times
  if [[ "${CI_BUILD}" != "no" && "${OS_NAME}" == "osx" ]]; then
    CXX=clang++ npm ci && break
  else
    npm ci && break
  fi

  if [[ $i == 5 ]]; then
    echo "Npm install failed too many times" >&2
    exit 1
  fi
  echo "Npm install failed $i, trying again..."

  sleep $(( 15 * (i + 1)))
done
# }}}

# package.json
cp package.json{,.bak}

setpath "package" "version" "${RELEASE_VERSION%-insider}"

replace 's|Microsoft Corporation|Kaivon|' package.json
replace "s|--max-old-space-size=8192|--max-old-space-size=${MAX_OLD_SPACE_SIZE}|" package.json

cp resources/server/manifest.json{,.bak}

setpath "resources/server/manifest" "name" "Kaivon Code"
setpath "resources/server/manifest" "short_name" "Kaivon Code"

# announcements
replace "s|\\[\\/\\* BUILTIN_ANNOUNCEMENTS \\*\\/\\]|$( tr -d '\n' < ../announcements-builtin.json )|" src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts

../undo_telemetry.sh

replace 's|Microsoft Corporation|Kaivon|' build/lib/electron.ts
replace 's|([0-9]) Microsoft|\1 Kaivon|' build/lib/electron.ts

if [[ "${OS_NAME}" == "linux" ]]; then
  # Microsoft's apt repo is added to sources unless the app is code-oss, so the check follows
  # the new name.
  sed -i "s/code-oss/kaivon-code/" resources/linux/debian/postinst.template

  # the packages' metadata
  sed -i 's|Visual Studio Code|Kaivon Code|g' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://code.kaivon.app|' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com/home/home-screenshot-linux-lg.png|https://code.kaivon.app/og.png|' resources/linux/code.appdata.xml
  sed -i 's|https://code.visualstudio.com|https://code.kaivon.app|' resources/linux/code.appdata.xml

  sed -i 's|Microsoft Corporation <vscode-linux@microsoft.com>|Kaivon <support@kaivon.app>|' resources/linux/debian/control.template
  sed -i 's|Visual Studio Code|Kaivon Code|g' resources/linux/debian/control.template
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://code.kaivon.app|' resources/linux/debian/control.template
  sed -i 's|https://code.visualstudio.com|https://code.kaivon.app|' resources/linux/debian/control.template

  sed -i 's|Microsoft Corporation|Kaivon|' resources/linux/rpm/code.spec.template
  sed -i 's|Visual Studio Code Team <vscode-linux@microsoft.com>|Kaivon <support@kaivon.app>|' resources/linux/rpm/code.spec.template
  sed -i 's|Visual Studio Code|Kaivon Code|' resources/linux/rpm/code.spec.template
  sed -i 's|https://code.visualstudio.com/docs/setup/linux|https://code.kaivon.app|' resources/linux/rpm/code.spec.template
  sed -i 's|https://code.visualstudio.com|https://code.kaivon.app|' resources/linux/rpm/code.spec.template
elif [[ "${OS_NAME}" == "windows" ]]; then
  sed -i 's|https://code.visualstudio.com|https://code.kaivon.app|' build/win32/code.iss
  sed -i 's|Microsoft Corporation|Kaivon|' build/win32/code.iss
fi

cd ..
