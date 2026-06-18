default:
    @just --list

check:
    pnpm run check

build:
    pnpm run build

pack:
    npm pack --dry-run

serve:
    cd docs && bundle install && bundle exec jekyll serve --livereload

publish: check build pack
    npm publish --access public
