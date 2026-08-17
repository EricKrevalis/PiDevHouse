{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      allSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs allSystems;
    in
    {
      nixosModules.default = {
        services.tailscale.enable = true;
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # Official Tauri development shell per the NixOS Wiki
          # (https://wiki.nixos.org/wiki/Tauri), plus the project toolchain
          # (bun, bubblewrap) and runtime libraries verified to load WebKitGTK.
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              pkg-config
              wrapGAppsHook4
              cargo
              rustc
              bun
              bubblewrap
              agent-browser
              chromium
              python3
            ];

            buildInputs = with pkgs; [
              librsvg
              webkitgtk_4_1
              gtk3
              libsoup_3
              glib
              glib-networking
              gdk-pixbuf
              libsecret
              openssl
            ];

            LD_LIBRARY_PATH = with pkgs; lib.makeLibraryPath [
              webkitgtk_4_1
              gtk3
              glib
              libsoup_3
              glib-networking
              gdk-pixbuf
              libsecret
              librsvg
              stdenv.cc.cc.lib
            ];

            shellHook = ''
              export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH"
              export OLLAMA_HOST="https://jupyter.tail2c3102.ts.net"
              export AGENT_BROWSER_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            '';
          };
        }
      );
    };
}
