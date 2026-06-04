import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const optionsHtml = readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
const optionsJs = readFileSync(new URL('../options/options.js', import.meta.url), 'utf8');

test('discussion body translation setting is exposed in storage and options UI', () => {
  assert.match(optionsJs, /enable_issue_pr_translation:\s*false/);
  assert.match(optionsHtml, /id="enable_issue_pr_translation"/);
  assert.match(optionsHtml, /Issue \/ PR \/ Release 正文翻译/);
});

test('content script can identify and decorate Issue and PR discussions', () => {
  assert.match(content, /function isIssueOrPrDiscussionPage\(/);
  assert.match(content, /function findDiscussionItems\(/);
  assert.match(content, /function mountDiscussionToolbar\(/);
  assert.match(content, /function createTranslatedClone\(/);
  assert.match(content, /function setDiscussionViewMode\(/);
  assert.match(content, /\[data-testid="issue-body-viewer"\] \[data-testid="markdown-body"\]/);
  assert.match(content, /data-ghcn-discussion-translate/);
  assert.doesNotMatch(content, /insertAdjacentElement\('beforebegin',\s*toolbar\)/);
});

test('content script reuses discussion translation for Release notes', () => {
  assert.match(content, /function isReleaseNotesPage\(/);
  assert.match(content, /function isDiscussionTranslationTargetPage\(/);
  assert.match(content, /RELEASE_BODY_SELECTORS/);
  assert.match(content, /div\.Box-body > div\.markdown-body/);
  assert.match(content, /sourceType:\s*isReleaseNotes \? 'release'/);
  assert.match(content, /ghcn-discussion-translate-toolbar--release/);
  assert.match(content, /if \(!slotEl && item\.sourceType !== 'release'\) return/);
  assert.match(content, /item\.viewerEl\.insertBefore\(toolbar,\s*item\.markdownEl\)/);
  assert.match(content, /getDiscussionRecordSourceType\(item\)/);
});

test('Issue and PR translation keeps original DOM and exposes view modes', () => {
  assert.match(content, /data-ghcn-discussion-view-mode/);
  assert.match(content, /ghcn-discussion-translation-panel/);
  assert.match(content, /original/);
  assert.match(content, /translated/);
  assert.match(content, /bilingual/);
});

test('Issue and PR translation uses GitHub green primary action and persistent errors', () => {
  assert.match(content, /ghcn-discussion-translate-btn--primary/);
  assert.match(content, /button-primary-bgColor-rest/);
  assert.match(content, /\.ghcn-discussion-translate-btn--primary:hover[\s\S]*button-primary-bgColor-hover/);
  assert.match(content, /\.ghcn-discussion-translate-btn\.is-active:hover[\s\S]*button-primary-bgColor-hover/);
  assert.match(content, /function normalizeRuntimeErrorMessage\(/);
  assert.match(content, /插件上下文已失效，请刷新当前 GitHub 页面后重试。/);
  assert.match(content, /normalizeRuntimeErrorMessage\(error\)/);
  assert.match(content, /errorMessage/);
  assert.match(content, /renderIssuePrError\(toolbar,\s*state\.errorMessage\)/);
  assert.match(content, /重试/);
});

test('translated clone does not inherit extension marker that skips text collection', () => {
  assert.match(content, /translatedEl\.removeAttribute\('data-ghcn-discussion-translate'\)/);
  assert.match(content, /translatedEl\.querySelectorAll\('\[data-ghcn-discussion-translate\]'\)/);
});

test('Issue and PR translation switch persists when toggled', () => {
  assert.match(optionsJs, /function savePartialValues\(/);
  assert.match(optionsJs, /savePartialValues\(\{\s*enable_issue_pr_translation:/);
});

test('Issue and PR translation follows README progressive cache and record settings', () => {
  assert.match(content, /function buildDiscussionCacheKey\(/);
  assert.match(content, /function getIssuePrRecordSourceType\(/);
  assert.match(content, /function getDiscussionRecordSourceType\(/);
  assert.match(content, /getRepoCachedTranslation\(cacheKey\)/);
  assert.match(content, /upsertRepoCachedTranslation\(cacheKey/);
  assert.match(content, /FeatureSet\.readme_enable_progressive/);
  assert.match(content, /appendReadmeTranslationRecord\(/);
  assert.match(content, /sourceType:\s*getDiscussionRecordSourceType\(item\)/);
  assert.match(content, /sourceType:\s*record\?\.sourceType \|\| 'readme'/);
  assert.match(optionsJs, /sourceType:\s*normalizeRecordSourceType\(item\.sourceType\)/);
  assert.match(optionsJs, /getRecordSourceMeta\(item\.sourceType\)/);
  assert.match(optionsJs, /release:\s*\{\s*label:\s*'Release'/);
  assert.match(content, /detail: `\$\{getDiscussionRecordSourceType\(item\)\}_translated_nodes=\$\{translatedCount\}`/);
});

test('Issue and PR translation covers React comments and legacy PR timeline comments', () => {
  assert.match(content, /IssueCommentBody/);
  assert.match(content, /comment-viewer-outer-box/);
  assert.match(content, /\.react-issue-comment/);
  assert.match(content, /\.timeline-comment-group/);
  assert.match(content, /ActionsButtonsContainer/);
  assert.match(content, /comment-header-right-side-items/);
  assert.match(content, /\.timeline-comment-actions/);
});
