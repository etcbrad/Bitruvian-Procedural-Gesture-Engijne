
import { CharacterMorphology } from '../types';
import { CharacterGenerator } from './characterGenerator';

export class CharacterLibraryManager {
  private db: IDBDatabase | null = null;
  private storeName = 'characters';

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('BitruviusCharacterDB', 2);
      req.onupgradeneeded = (e) => {
        const db = (e.target as any).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  async saveCharacter(char: CharacterMorphology): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction([this.storeName], 'readwrite');
    tx.objectStore(this.storeName).put(char);
  }

  async getAllCharacters(): Promise<CharacterMorphology[]> {
    if (!this.db) return [];
    return new Promise((resolve) => {
      const req = this.db!.transaction([this.storeName], 'readonly').objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result);
    });
  }

  async deleteCharacter(id: string): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction([this.storeName], 'readwrite');
    tx.objectStore(this.storeName).delete(id);
  }
}
