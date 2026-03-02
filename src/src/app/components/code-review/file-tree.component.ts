import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { DiffFile } from 'diff2html/lib/types';

/**
 * Represents a node in the file tree (directory or file).
 */
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  /** Index into the flat files array — only set on file nodes */
  fileIndex?: number;
  /** Git status badge (A/M/D) — only set on file nodes */
  status?: 'A' | 'M' | 'D';
}

/**
 * VS Code-style file tree component for the code review panel.
 *
 * Displays the list of changed files as a directory tree with:
 * - Status indicators: A (Added), M (Modified), D (Deleted)
 * - Directory expand/collapse with chevron
 * - Click-to-select file highlighting
 * - Keyboard navigation: ArrowUp/Down to move, Enter to select
 * - Reviewed files get a checkmark and dimmed styling
 */
@Component({
  selector: 'app-file-tree',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-tree.component.html',
  styleUrls: ['./file-tree.component.css'],
})
export class FileTreeComponent implements OnChanges {
  @Input() files: DiffFile[] = [];
  @Input() selectedIndex = 0;
  @Input() reviewedIndices: Set<number> = new Set();
  @Output() fileSelected = new EventEmitter<number>();

  /** Root nodes of the tree (top-level directories or files) */
  rootNodes: TreeNode[] = [];

  /** Expanded directory paths */
  expandedPaths = new Set<string>();

  /** Flat ordered list of file indices for keyboard navigation */
  private flatFileIndices: number[] = [];

  ngOnChanges(): void {
    this.buildTree();
  }

  private buildTree(): void {
    const root: TreeNode = {
      name: '',
      path: '',
      isDirectory: true,
      children: [],
    };

    // Build tree structure from file paths
    this.files.forEach((file, index) => {
      const filePath = file.newName !== '/dev/null' ? file.newName : file.oldName;
      const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
      const status = this.getFileStatus(file);

      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        const dirPath = parts.slice(0, i + 1).join('/');
        let child = current.children.find(c => c.isDirectory && c.name === dirName);
        if (!child) {
          child = { name: dirName, path: dirPath, isDirectory: true, children: [] };
          current.children.push(child);
          // Expand all directories by default
          this.expandedPaths.add(dirPath);
        }
        current = child;
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      const fileNode: TreeNode = {
        name: fileName,
        path: filePath,
        isDirectory: false,
        children: [],
        fileIndex: index,
        status,
      };
      current.children.push(fileNode);
    });

    this.rootNodes = root.children;
    this.rebuildFlatList();
  }

  private getFileStatus(file: DiffFile): 'A' | 'M' | 'D' {
    if (file.oldName === '/dev/null' || file.oldName === 'dev/null') return 'A';
    if (file.newName === '/dev/null' || file.newName === 'dev/null') return 'D';
    return 'M';
  }

  private rebuildFlatList(): void {
    this.flatFileIndices = [];
    this.collectFiles(this.rootNodes, this.flatFileIndices);
  }

  private collectFiles(nodes: TreeNode[], result: number[]): void {
    for (const node of nodes) {
      if (node.isDirectory) {
        if (this.expandedPaths.has(node.path)) {
          this.collectFiles(node.children, result);
        }
      } else if (node.fileIndex !== undefined) {
        result.push(node.fileIndex);
      }
    }
  }

  toggleDirectory(node: TreeNode): void {
    if (this.expandedPaths.has(node.path)) {
      this.expandedPaths.delete(node.path);
    } else {
      this.expandedPaths.add(node.path);
    }
    this.rebuildFlatList();
  }

  isExpanded(node: TreeNode): boolean {
    return this.expandedPaths.has(node.path);
  }

  selectFile(fileIndex: number): void {
    this.fileSelected.emit(fileIndex);
  }

  isReviewed(fileIndex: number): boolean {
    return this.reviewedIndices.has(fileIndex);
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const currentPos = this.flatFileIndices.indexOf(this.selectedIndex);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (currentPos < this.flatFileIndices.length - 1) {
        this.fileSelected.emit(this.flatFileIndices[currentPos + 1]);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (currentPos > 0) {
        this.fileSelected.emit(this.flatFileIndices[currentPos - 1]);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (currentPos >= 0) {
        this.fileSelected.emit(this.flatFileIndices[currentPos]);
      }
    }
  }
}
