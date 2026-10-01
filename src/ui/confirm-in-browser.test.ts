import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmInBrowser } from "./confirm-in-browser.ts";

const question = { title: "Revoke this allowance?", message: "Agent A stops spending now." };

test("confirming runs the action, and the dialog shows the title and the whole message", () => {
  let asked = "";
  let ran = false;
  confirmInBrowser(question, () => { ran = true; }, (text) => { asked = text; return true; });
  assert.equal(ran, true);
  assert.equal(asked, "Revoke this allowance?\n\nAgent A stops spending now.");
});

test("cancelling runs nothing", () => {
  let ran = false;
  confirmInBrowser(question, () => { ran = true; }, () => false);
  assert.equal(ran, false);
});
