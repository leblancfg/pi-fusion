default:
    @just --list

check:
    pnpm run check

build:
    pnpm run build

pack:
    npm pack --dry-run

publish: check build pack
    npm publish --access public
