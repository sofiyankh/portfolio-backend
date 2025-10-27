#!/bin/bash

# ─── Config ───────────────────────────────────────────────────────────
REPO="https://github.com/sofiyankh/portfolio-backend.git"
BRANCH="main"

# ─── Colors ───────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}▶ Starting backend deploy...${NC}"

# ─── Safety check ─────────────────────────────────────────────────────
if [ ! -f "server.js" ]; then
  echo -e "${RED}✗ server.js not found. Run this script from inside the backend/ folder.${NC}"
  exit 1
fi

# ─── .gitignore ───────────────────────────────────────────────────────
cat > .gitignore << 'EOF'
node_modules/
.env
EOF
echo -e "${GREEN}✓ .gitignore ready${NC}"

# ─── Init git if needed ───────────────────────────────────────────────
if [ ! -d ".git" ]; then
  git init
  echo -e "${GREEN}✓ Git initialized${NC}"
fi

# ─── Set remote ───────────────────────────────────────────────────────
git remote remove origin 2>/dev/null
git remote add origin "$REPO"
echo -e "${GREEN}✓ Remote set to $REPO${NC}"

# ─── Stage files ──────────────────────────────────────────────────────
git add .

# ─── Fake commit date starting from Oct 28 2025 ──────────────────────
# Each run increments by 1 day from the base date
BASE_DATE="2025-10-28"
BASE_EPOCH=$(date -d "$BASE_DATE" +%s)

# Track how many commits already exist to increment the date
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo 0)
OFFSET_SECONDS=$(( COMMIT_COUNT * 86400 ))  # +1 day per commit
COMMIT_EPOCH=$(( BASE_EPOCH + OFFSET_SECONDS ))
COMMIT_DATE=$(date -d "@$COMMIT_EPOCH" '+%Y-%m-%dT%H:%M:%S')

COMMIT_MSG="deploy: $(date -d "@$COMMIT_EPOCH" '+%Y-%m-%d')"

echo -e "${YELLOW}▶ Committing with date: $COMMIT_DATE${NC}"

GIT_AUTHOR_DATE="$COMMIT_DATE" \
GIT_COMMITTER_DATE="$COMMIT_DATE" \
git commit -m "$COMMIT_MSG" 2>/dev/null || echo -e "${YELLOW}⚠ Nothing new to commit${NC}"

git branch -M "$BRANCH"

# ─── Push ─────────────────────────────────────────────────────────────
echo -e "${YELLOW}▶ Pushing to GitHub...${NC}"
git push -u origin "$BRANCH" --force

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Backend deployed successfully → $REPO${NC}"
  echo -e "${GREEN}✓ Commit dated: $COMMIT_DATE${NC}"
else
  echo -e "${RED}✗ Push failed. Check your credentials or repo access.${NC}"
  exit 1
fi
