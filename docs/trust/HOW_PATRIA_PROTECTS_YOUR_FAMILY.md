# How Patria Protects Your Family

*Patria's architecture in plain language. Version 1, October 29, 2026. Patria is in early testing; this paper will be updated as Patria grows.*

## The short version

- Your family's information belongs to your family. Patria does not sell it, rent it or use it for advertising.
- The most private things, kept in the Legacy Vault, are locked on your phones before they leave. Patria never holds the key, so no one at Patria can read them.
- Everyday family information, such as photos and meetings, is protected by strict rules that decide exactly who in your family can see what.
- A new phone never gets your family's keys unless a person in your family approves it.
- No AI reads anything in Patria today. When AI help arrives, it will be optional, per person, and will never read the Vault.

## What Patria keeps, and where

Patria keeps your account (name and email), your family space (members, roles and circles), and what your family adds: photos and short videos, meeting agendas, notes and tasks, replies, and Vault entries.

This information is stored with Supabase, a database and storage service that runs on Amazon Web Services in the eastern United States. It is encrypted while it travels between your phone and Patria, and encrypted where it is stored.

Some small things stay only on your phone, such as your appearance setting, unsent drafts, and the keys that unlock your Vault.

## Two levels of protection

### Everyday family information

Photos, videos, meetings, agendas, tasks and replies are protected the way leading photo and calendar services protect them, with extra rules on top:

- **Circles decide who sees what.** Household, Extended Family, Close Friends and Only Me. The database itself checks every request, so the app cannot show something to the wrong person by mistake.
- **No public links.** Photos open through private links that expire within minutes and only work for people allowed to see them.
- **Location removed.** Your phone removes the hidden location from photos before they are uploaded. Videos that still contain a location are refused.
- **Access ends when someone leaves** a circle or the family.

Honest note: at this level, Patria's systems could technically open this information, in the same way Apple can with iCloud's standard setting and Google can with Google Photos. Patria's promise here is strict rules and no selling or advertising.

### Private by design: the Legacy Vault

The Legacy Vault holds a family's most private records, such as the big decisions and why they were made, and voice notes.

- **Locked on your phone.** Everything is locked on your phone before it is sent. Patria's servers only ever hold scrambled data.
- **Keys made on phones.** Each family has a family key, created on a family member's phone. Patria never holds a usable copy.
- **Even the length is hidden.** Entries are padded so their size does not reveal what they contain.
- **Only me entries** are locked with a personal key that only your own phones hold.

## Phones and family keys

- **A person approves every new phone.** A password alone can never unlock your family's Vault. An existing phone or a family admin must approve a new phone first.
- **Keys stay on the phone.** Keys are kept in the phone's secure storage, set to this device only, so they are not copied into backups or other phones.
- **When someone leaves,** Patria creates a new family key and locks everything again in one step, so a person who has left cannot open anything new.

## If you lose your phone

- If you have another phone or tablet with Patria, it can approve your new phone.
- If you lose every device, two of your three recovery helpers, or one helper plus your printed recovery code, can restore your access after a 48 hour safety wait. You or a family admin can stop a recovery during that wait.
- Your printed code is never stored by Patria.

Honest note: if you lose every device and cannot reach your helpers or your printed code, your Vault cannot be recovered. That is the price of nobody else holding a key.

## What people at Patria can and cannot see

- **Cannot:** read your Vault, see your keys, or see your printed recovery code.
- **Do not:** browse your family's information. Patria is in early testing and only its founder has access to its systems. A written rule for staff access will be published before the first families join.
- **Logs:** Patria's app and servers never record keys, recovery codes, invite links or personal content in their logs.

## AI and the Patria Brain

No AI reads anything in Patria today.

Patria is designing an optional feature, the Patria Brain, that finds action items in your messages and suggests them for your week and your family meeting. It will follow these rules:

- **You choose your level:** *Only what I send* (you paste, share or forward specific emails), *Private on my phone* (Patria reads your email on your phone and your email never leaves it), or *Patria Cloud* (you forward email to Patria for processing).
- **Each adult opts in for themselves.** Children are excluded. The Vault is never read by AI.
- **In Patria Cloud,** email is processed in memory and not stored, any short retry queue is encrypted and empties itself, email content is never written to logs, and the AI provider must agree in writing not to train on it and to keep it for as short a time as possible.
- **Suggestions only.** The AI cannot send, delete or change anything, and cannot open links. You always tap to accept.

## How we check our work

- Every change is checked by automated tests, including more than 500 tests of the database rules that decide who can see what.
- Patria is tested on real phones before each feature is released to testers.
- An independent security review is planned before Patria opens to the public.

## Questions

Write to support.patria@gmail.com. We will answer in plain language.
