/**
 * Naming utilities for computing resource names
 */

import { CONTAINER_PREFIX } from '../config/constants';

/**
 * Compute Docker container name for a branch
 * Format: pgd-{project}-{branch}
 */
export function getContainerName(projectName: string, branchName: string): string {
  return `${CONTAINER_PREFIX}-${projectName}-${branchName}`;
}

/**
 * Compute ZFS dataset name for a branch
 * Format: {project}-{branch}
 */
export function getDatasetName(projectName: string, branchName: string): string {
  return `${projectName}-${branchName}`;
}

/**
 * Compute full ZFS dataset path for a branch
 * Format: {pool}/{datasetBase}/{project}-{branch}
 */
export function getDatasetPath(pool: string, datasetBase: string, projectName: string, branchName: string): string {
  const datasetName = getDatasetName(projectName, branchName);
  return `${pool}/${datasetBase}/${datasetName}`;
}
