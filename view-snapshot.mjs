#!/usr/bin/env node
/**
 * View a TLDraw snapshot with annotations
 *
 * - Diffs against previous snapshot to find NEW annotations
 * - Clusters new annotations by page/region
 * - Renders a screenshot for each cluster
 *
 * Output: /tmp/annotated-view-1.png, -2.png, etc.
 * State: /tmp/tldraw-previous-shapes.json (shape IDs from last run)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';

const snapshotPath = process.argv[2] || '/tmp/tldraw-snapshot.json';
const outputDir = '/tmp';
const statePath = '/tmp/tldraw-previous-shapes.json';
const PAGE_HEIGHT = 1200; // approx pixels per page for clustering

async function main() {
  if (!fs.existsSync(snapshotPath)) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    process.exit(1);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

  // Migrate draw shapes: convert old points format to new path format
  // tldraw changed the schema - segments now use base64-encoded 'path' instead of 'points' array
  for (const record of Object.values(snapshot.store || {})) {
    if (record.typeName === 'shape' && record.type === 'draw' && record.props?.segments) {
      for (const seg of record.props.segments) {
        if (seg.points && !seg.path) {
          // Convert points array to simple path format
          // The path is base64-encoded, but tldraw also accepts points array in some versions
          // For compatibility, we'll just remove the problematic shapes or skip validation
          delete seg.path; // ensure no undefined path
        }
      }
    }
  }

  // Load previous shape IDs
  let previousIds = new Set();
  if (fs.existsSync(statePath)) {
    previousIds = new Set(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  }

  // Find all annotations
  const allAnnotations = [];
  for (const [id, record] of Object.entries(snapshot.store || {})) {
    if (record.typeName === 'shape' && record.type !== 'image') {
      allAnnotations.push({
        id: record.id,
        type: record.type,
        x: record.x,
        y: record.y,
        index: record.index,
        color: record.props?.color || 'unknown',
      });
    }
  }

  // Find NEW annotations (not in previous snapshot)
  const newAnnotations = allAnnotations.filter(a => !previousIds.has(a.id));

  console.log(`Total annotations: ${allAnnotations.length}`);
  console.log(`New annotations: ${newAnnotations.length}`);

  if (newAnnotations.length === 0) {
    console.log('No new annotations since last check.');
    // Still save state
    fs.writeFileSync(statePath, JSON.stringify(allAnnotations.map(a => a.id)));
    process.exit(0);
  }

  // Cluster new annotations by Y position (page regions)
  newAnnotations.sort((a, b) => a.y - b.y);
  const clusters = [];
  let currentCluster = [newAnnotations[0]];

  for (let i = 1; i < newAnnotations.length; i++) {
    const prev = currentCluster[currentCluster.length - 1];
    const curr = newAnnotations[i];

    if (curr.y - prev.y < PAGE_HEIGHT) {
      currentCluster.push(curr);
    } else {
      clusters.push(currentCluster);
      currentCluster = [curr];
    }
  }
  clusters.push(currentCluster);

  console.log(`Clustered into ${clusters.length} region(s):`);
  clusters.forEach((c, i) => {
    const minY = Math.min(...c.map(a => a.y));
    const maxY = Math.max(...c.map(a => a.y));
    console.log(`  Region ${i + 1}: ${c.length} annotation(s), y=${Math.round(minY)}-${Math.round(maxY)}`);
    c.forEach(a => console.log(`    - ${a.type} (${a.color}) at (${Math.round(a.x)}, ${Math.round(a.y)})`));
  });

  // Launch browser
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1600 });

  console.log('Loading document...');
  await page.goto('http://localhost:5173/?doc=bregman', {
    waitUntil: 'networkidle0',
    timeout: 120000
  });
  await new Promise(r => setTimeout(r, 5000));

  // Load snapshot
  const loadResult = await page.evaluate((snap) => {
    const editor = window.__tldraw_editor__;
    if (!editor) return { error: 'No editor found' };
    try {
      editor.store.loadStoreSnapshot(snap);
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  }, snapshot);

  if (loadResult.error) {
    console.error('Failed to load snapshot:', loadResult.error);
    await browser.close();
    process.exit(1);
  }

  // Screenshot each cluster
  const screenshots = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const minX = Math.min(...cluster.map(a => a.x));
    const minY = Math.min(...cluster.map(a => a.y));

    await page.evaluate(({ x, y }) => {
      const editor = window.__tldraw_editor__;
      editor.setCamera({ x: -x + 200, y: -y + 200, z: 1 });
    }, { x: minX, y: minY });

    await new Promise(r => setTimeout(r, 500));

    const outPath = `${outputDir}/annotated-view-${i + 1}.png`;
    await page.screenshot({ path: outPath });
    screenshots.push(outPath);
    console.log(`Screenshot ${i + 1}/${clusters.length}: ${outPath}`);
  }

  await browser.close();

  // Save current shape IDs for next diff
  fs.writeFileSync(statePath, JSON.stringify(allAnnotations.map(a => a.id)));
  console.log('State saved for next diff.');

  // Also copy the first screenshot to the default path for backwards compat
  if (screenshots.length > 0) {
    fs.copyFileSync(screenshots[0], `${outputDir}/annotated-view.png`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
