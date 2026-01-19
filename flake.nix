{
  description = "Chess Clock UNO - Real-time multiplayer UNO with chess clock mechanics";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  nixConfig = {
    extra-substituters = [
      "https://cache.nixos.org"
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  outputs = { self, nixpkgs, flake-utils, bun2nix }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        b2n = bun2nix.packages.${system}.default;
        
        # Version from package.json (Docker-compatible format: no + character)
        version = "2026.1.19-8";

        # Fetch bun dependencies using bun2nix
        bunDeps = b2n.fetchBunDeps {
          bunNix = ./bun.nix;
        };

        # Client build (React/Vite website)
        clientBuild = pkgs.stdenv.mkDerivation {
          pname = "ccu-client";
          inherit version;
          src = ./.;

          nativeBuildInputs = [
            pkgs.bun
            pkgs.nodejs
            b2n.hook
          ];

          inherit bunDeps;

          # Build from client subdirectory
          bunRoot = "client";

          buildPhase = ''
            # Build shared types first (dependency for client)
            cd shared
            bun run build
            cd ..
            
            # Build client
            cd client
            bun run build
            cd ..
          '';

          installPhase = ''
            mkdir -p $out
            cp -r client/dist/. $out/
          '';
        };

        # Server build (TypeScript compiled with tsc)
        serverBuild = pkgs.stdenv.mkDerivation {
          pname = "ccu-server";
          inherit version;
          src = ./.;

          nativeBuildInputs = [
            pkgs.bun
            pkgs.nodejs
            b2n.hook
          ];

          inherit bunDeps;

          buildPhase = ''
            # Build shared types first (dependency for server)
            cd shared
            bun run build
            cd ..
            
            # Build server
            cd server
            bun run build
            cd ..
          '';

          installPhase = ''
            mkdir -p $out/dist
            cp -r server/dist/. $out/dist/
            cp server/package.json $out/
            # Copy shared types (needed at runtime for type references)
            mkdir -p $out/shared/src
            cp -r shared/src/. $out/shared/src/
          '';
        };

        # Docker image for client (static files served by darkhttpd)
        clientImage = pkgs.dockerTools.buildImage {
          name = "ccu-client";
          tag = version;
          
          copyToRoot = pkgs.buildEnv {
            name = "ccu-client-root";
            paths = [ pkgs.darkhttpd pkgs.busybox ];
            pathsToLink = [ "/bin" ];
          };

          runAsRoot = ''
            mkdir -p /srv
            cp -r ${clientBuild}/* /srv/
          '';

          config = {
            # Use sh to read PORT env var, default 12121
            Cmd = [ "/bin/sh" "-c" "darkhttpd /srv --port \${PORT:-12121}" ];
            ExposedPorts = { "12121/tcp" = {}; };
            WorkingDir = "/srv";
            Env = [ "PORT=12121" ];
          };
        };

        # Docker image for server
        serverImage = pkgs.dockerTools.buildImage {
          name = "ccu-server";
          tag = version;

          copyToRoot = pkgs.buildEnv {
            name = "ccu-server-root";
            paths = [ pkgs.bun pkgs.curl serverBuild ];
            pathsToLink = [ "/bin" ];
          };

          runAsRoot = ''
            mkdir -p /app
            cp -r ${serverBuild}/* /app/
            mkdir -p /app/avatars
          '';

          config = {
            Cmd = [ "${pkgs.bun}/bin/bun" "run" "/app/dist/index.js" ];
            ExposedPorts = { "12122/tcp" = {}; };
            WorkingDir = "/app";
            Env = [
              "PORT=12122"
              "AVATAR_DIR=/app/avatars"
            ];
          };
        };

      in
      {
        packages = {
          inherit clientBuild serverBuild clientImage serverImage;
          default = serverBuild;
        };

        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs
            typescript
            b2n
          ];

          shellHook = ''
            echo "Chess Clock UNO development environment"
            echo "Run 'bun install' to install dependencies"
            echo ""
            echo "Commands:"
            echo "  cd server && bun run dev  - Start server"
            echo "  cd client && bun run dev  - Start client"
            echo ""
            echo "Build Docker images:"
            echo "  nix build .#clientImage"
            echo "  nix build .#serverImage"
            echo ""
            echo "Regenerate bun.nix after updating dependencies:"
            echo "  bunx bun2nix -o bun.nix"
          '';
        };

        # Apps for running directly
        apps = {
          server = {
            type = "app";
            program = "${pkgs.writeShellScript "run-server" ''
              cd ${serverBuild}
              ${pkgs.bun}/bin/bun run dist/index.js
            ''}";
          };
        };
      }
    );
}
