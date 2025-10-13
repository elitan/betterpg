#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if we're in the project root
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Run this script from the project root."
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    print_error "You have uncommitted changes. Commit or stash them before releasing."
    git status --short
    exit 1
fi

# Get current version
CURRENT_VERSION=$(cat package.json | grep '"version"' | head -1 | awk -F'"' '{print $4}')
print_info "Current version: ${CURRENT_VERSION}"

# Get version bump type (patch, minor, major)
VERSION_TYPE=${1:-patch}

if [ "$VERSION_TYPE" != "patch" ] && [ "$VERSION_TYPE" != "minor" ] && [ "$VERSION_TYPE" != "major" ]; then
    print_error "Invalid version type: ${VERSION_TYPE}"
    echo "Usage: ./scripts/release.sh [patch|minor|major]"
    echo "  patch: 0.3.4 -> 0.3.5 (bug fixes)"
    echo "  minor: 0.3.4 -> 0.4.0 (new features)"
    echo "  major: 0.3.4 -> 1.0.0 (breaking changes)"
    exit 1
fi

# Calculate new version
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

case $VERSION_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
print_info "New version: ${NEW_VERSION}"

# Confirm with user
read -p "$(echo -e ${YELLOW}▶${NC} Release version ${NEW_VERSION}? [y/N]: )" -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Release cancelled"
    exit 0
fi

print_info "Starting release process..."

# Update version in package.json
print_info "Updating package.json..."
sed -i.bak "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
rm -f package.json.bak
print_success "Updated package.json"

# Update CHANGELOG.md
CHANGELOG_FILE="CHANGELOG.md"
DATE=$(date +%Y-%m-%d)

if [ ! -f "$CHANGELOG_FILE" ]; then
    print_info "Creating CHANGELOG.md..."
    cat > "$CHANGELOG_FILE" << EOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [${NEW_VERSION}] - ${DATE}

### Added
- Initial release

EOF
    print_success "Created CHANGELOG.md"
else
    print_info "Updating CHANGELOG.md..."
    # Insert new version section after the header
    sed -i.bak "/^## \[/i\\
## [${NEW_VERSION}] - ${DATE}\\
\\
### Added\\
- (Add new features here)\\
\\
### Changed\\
- (Add changes here)\\
\\
### Fixed\\
- (Add bug fixes here)\\
\\
" "$CHANGELOG_FILE"
    rm -f "${CHANGELOG_FILE}.bak"
    print_success "Updated CHANGELOG.md"
    print_warning "Remember to update the changelog entries!"
fi

# Build the project
print_info "Building project..."
bun run build
print_success "Build complete"

# Run tests
print_info "Running tests..."
if ./scripts/test.sh > /dev/null 2>&1; then
    print_success "All tests passed"
else
    print_error "Tests failed. Fix them before releasing."
    # Revert changes
    git checkout package.json "$CHANGELOG_FILE" 2>/dev/null || true
    rm -f package.json.bak "${CHANGELOG_FILE}.bak"
    exit 1
fi

# Commit changes
print_info "Committing changes..."
git add package.json "$CHANGELOG_FILE"
git commit -m "Release v${NEW_VERSION}"
print_success "Changes committed"

# Create git tag
print_info "Creating git tag..."
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
print_success "Tag v${NEW_VERSION} created"

# Push to GitHub
print_info "Pushing to GitHub..."
git push
git push --tags
print_success "Pushed to GitHub"

echo
print_success "Release v${NEW_VERSION} complete!"
echo
print_info "GitHub Actions will automatically publish to npm"
echo "Monitor the workflow at: https://github.com/elitan/velo/actions"
