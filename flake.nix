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
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              bun
              agent-browser
              chromium
              python3
            ];

            shellHook = ''
              export AGENT_BROWSER_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            '';
          };
        }
      );
    };
}
