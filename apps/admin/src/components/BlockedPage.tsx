import React from 'react';
import { PageHeader, BlockedFeature } from '@faculty-scheduling/ui';

interface BlockedPageProps {
  pageTitle: string;
  pageSubtitle: string;
  blockedTitle: string;
  blockedDescription: string;
  neededEndpoint: string;
}

/**
 * Shared shape for every admin screen that has no real backend to call yet.
 * Local to apps/admin — not a packages/ui component, since it's just a thin
 * composition of PageHeader + BlockedFeature for this app's honest-by-default
 * pages.
 */
export function BlockedPage({
  pageTitle,
  pageSubtitle,
  blockedTitle,
  blockedDescription,
  neededEndpoint,
}: BlockedPageProps): React.ReactElement {
  return (
    <>
      <PageHeader title={pageTitle} subtitle={pageSubtitle} />
      <BlockedFeature title={blockedTitle} description={blockedDescription} neededEndpoint={neededEndpoint} />
    </>
  );
}
