add db.js
const DB_NAME = "finance_app_db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("expenses")) {
        const s = db.createObjectStore("expenses", { keyPath: "id" });
        s.createIndex("by_purchaseDate", "purchaseDate", { unique: false });
        s.createIndex("by_month", "monthKey", { unique: false });
      }

      if (!db.objectStoreNames.contains("installments")) {
        const s = db.createObjectStore("installments", { keyPath: "id" });
        s.createIndex("by_expenseId", "expenseId", { unique: false });
        s.createIndex("by_dueDate", "dueDate", { unique: false });
        s.createIndex("by_month", "monthKey", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function addExpenseWithInstallments(expense, installments) {
  const db = await openDB();
  const tx = db.transaction(["expenses", "installments"], "readwrite");
  tx.objectStore("expenses").add(expense);
  const store = tx.objectStore("installments");
  for (const inst of installments) store.add(inst);
  await txDone(tx);
  db.close();
}

export async function listExpensesByMonth(monthKey) {
  const db = await openDB();
  const tx = db.transaction(["expenses", "installments"], "readonly");
  const expStore = tx.objectStore("expenses");
  const idx = expStore.index("by_month");

  const expenses = await new Promise((resolve, reject) => {
    const out = [];
    const req = idx.openCursor(IDBKeyRange.only(monthKey));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const instStore = tx.objectStore("installments").index("by_expenseId");
  const stats = new Map();

  for (const e of expenses) {
    const all = await new Promise((resolve, reject) => {
      const out = [];
      const req = instStore.openCursor(IDBKeyRange.only(e.id));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push(c.value);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });

    const paid = all.filter(x => x.paid).length;
    stats.set(e.id, { paid, total: all.length, installments: all });
  }

  await txDone(tx);
  db.close();
  return { expenses, stats };
}

export async function getExpenseDetail(expenseId) {
  const db = await openDB();
  const tx = db.transaction(["expenses", "installments"], "readonly");
  const expStore = tx.objectStore("expenses");
  const instIdx = tx.objectStore("installments").index("by_expenseId");

  const expense = await new Promise((resolve, reject) => {
    const req = expStore.get(expenseId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  const installments = await new Promise((resolve, reject) => {
    const out = [];
    const req = instIdx.openCursor(IDBKeyRange.only(expenseId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out.sort((a,b)=>a.number-b.number));
      out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();
  return { expense, installments };
}

export async function toggleInstallmentPaid(installmentId, paid) {
  const db = await openDB();
  const tx = db.transaction(["installments"], "readwrite");
  const store = tx.objectStore("installments");

  const inst = await new Promise((resolve, reject) => {
    const req = store.get(installmentId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!inst) {
    db.close();
    return;
  }

  inst.paid = paid;
  inst.paidAt = paid ? new Date().toISOString() : null;
  store.put(inst);

  await txDone(tx);
  db.close();
}

export async function setAllPaid(expenseId, paid) {
  const db = await openDB();
  const tx = db.transaction(["installments"], "readwrite");
  const idx = tx.objectStore("installments").index("by_expenseId");

  await new Promise((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.only(expenseId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const v = c.value;
      v.paid = paid;
      v.paidAt = paid ? new Date().toISOString() : null;
      c.update(v);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();
}

export async function deleteExpense(expenseId) {
  const db = await openDB();
  const tx = db.transaction(["expenses", "installments"], "readwrite");

  tx.objectStore("expenses").delete(expenseId);

  const idx = tx.objectStore("installments").index("by_expenseId");
  await new Promise((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.only(expenseId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      c.delete();
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });

  await txDone(tx);
  db.close();
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(["expenses", "installments"], "readwrite");
  tx.objectStore("expenses").clear();
  tx.objectStore("installments").clear();
  await txDone(tx);
  db.close();
}

