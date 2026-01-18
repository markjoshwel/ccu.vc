{
  description = "Chess Clock UNO - Real-time multiplayer UNO with chess clock mechanics";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        # Version from package.json
        version = "2026.1.19";

        # Client build
        clientBuild = pkgs.stdenv.mkDerivation {
          pname = "ccu-client";
          inherit version;
          src = ./.;

          nativeBuildInputs = with pkgs; [ bun nodejs ];

          buildPhase = ''
            export HOME=$(mktemp -d)
            cd client
            bun install --frozen-lockfile
            bun run build
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };

        # Server build  
        serverBuild = pkgs.stdenv.mkDerivation {
          pname = "ccu-server";
          inherit version;
          src = ./.;

          nativeBuildInputs = with pkgs; [ bun nodejs ];

          buildPhase = ''
            export HOME=$(mktemp -d)
            bun install --frozen-lockfile
            cd server
            bun run build
          '';

          installPhase = ''
            mkdir -p $out/dist
            mkdir -p $out/node_modules
            cp -r dist/* $out/dist/
            cp package.json $out/
            # Copy shared types
            mkdir -p $out/shared
            cp -r ../shared/src $out/shared/
          '';
        };

        # Docker image for client (static files served by nginx)
        clientImage = pkgs.dockerTools.buildImage {
          name = "ccu-client";
          tag = version;
          
          copyToRoot = pkgs.buildEnv {
            name = "ccu-client-root";
            paths = [ pkgs.nginx clientBuild ];
            pathsToLink = [ "/bin" "/etc" "/var" ];
          };

          runAsRoot = ''
            mkdir -p /var/log/nginx /var/cache/nginx /run
            mkdir -p /usr/share/nginx/html
            cp -r ${clientBuild}/* /usr/share/nginx/html/
          '';

          config = {
            Cmd = [ "${pkgs.nginx}/bin/nginx" "-g" "daemon off;" ];
            ExposedPorts = { "80/tcp" = {}; };
            WorkingDir = "/usr/share/nginx/html";
          };
        };

        # Docker image for server
        serverImage = pkgs.dockerTools.buildImage {
          name = "ccu-server";
          tag = version;

          copyToRoot = pkgs.buildEnv {
            name = "ccu-server-root";
            paths = [ pkgs.bun serverBuild ];
            pathsToLink = [ "/bin" ];
          };

          runAsRoot = ''
            mkdir -p /app
            cp -r ${serverBuild}/* /app/
            mkdir -p /app/avatars
          '';

          config = {
            Cmd = [ "${pkgs.bun}/bin/bun" "run" "/app/dist/index.js" ];
            ExposedPorts = { "3000/tcp" = {}; };
            WorkingDir = "/app";
            Env = [
              "PORT=3000"
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
