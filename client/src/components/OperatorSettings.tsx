/**
 * Dashboard → Settings for operators: two short tabs instead of one long form.
 *   - Business profile: logo, business name, your name, bio — what guests see,
 *     saved together with one "Save changes" (enabled only when something changed).
 *   - Account: sign-in email, password, Telegram booking updates, sign out.
 * Each setting is a row (SettingsRow): what it is on the left, the control on
 * the right. Same profile writes as /account's ProfileTab (AuthContext
 * updateProfile; logo uploaded to the operator's storage folder).
 */
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/PasswordInput";
import { SettingsRow } from "@/components/SettingsRow";
import { TelegramConnect } from "@/components/TelegramConnect";
import { uploadImage } from "@/lib/imageUpload";
import { userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "profile", label: "Business profile" },
  { key: "account", label: "Account" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const primary = "h-11 rounded-none bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90 disabled:opacity-40";

export function OperatorSettings() {
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <div className="max-w-4xl">
      <div role="group" aria-label="Settings" className="mb-6 inline-flex rounded-full border border-basalt/15 bg-paper p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
              tab === t.key ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "profile" ? <BusinessProfile /> : <AccountSettings />}
    </div>
  );
}

function BusinessProfile() {
  const { profile, user, updateProfile } = useAuth();
  const initial = {
    displayName: profile?.displayName ?? "",
    businessName: profile?.businessName ?? "",
    bio: profile?.bio ?? "",
    logoUrl: profile?.logoUrl ?? "",
  };
  const [form, setForm] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Re-seed when the profile loads or changes under us.
  useEffect(() => setForm(initial), [profile?.displayName, profile?.businessName, profile?.bio, profile?.logoUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k].trim() !== initial[k].trim());

  const onLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      set("logoUrl", await uploadImage(file, user.id));
    } catch (err) {
      toast(userMessage(err, "Couldn't upload the logo."));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim()) return toast("Your name can't be blank.");
    setSaving(true);
    try {
      await updateProfile({
        displayName: form.displayName.trim(),
        bio: form.bio.trim() || null,
        businessName: form.businessName.trim() || null,
        ...(form.logoUrl !== initial.logoUrl ? { logoUrl: form.logoUrl || null } : {}),
      });
      toast.success("Profile saved.");
    } catch (err) {
      toast(userMessage(err, "Couldn't save your profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <div className="divide-y divide-basalt/10 border-y border-basalt/10 py-6">
        <SettingsRow title="Logo" help="Shown next to your business name on your listings. A square image works best.">
          <div className="flex items-center gap-4">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="Your logo" className="h-16 w-16 rounded-full border border-basalt/15 object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-basalt/25 text-[11px] font-semibold uppercase tracking-wide text-basalt/50">Logo</div>
            )}
            <label className="cursor-pointer rounded-none border border-basalt/15 px-4 py-2.5 text-sm font-semibold transition-colors hover:border-basalt/40 focus-within:outline-2 focus-within:outline-apricot">
              {uploading ? "Uploading…" : form.logoUrl ? "Replace" : "Upload logo"}
              <input type="file" accept="image/*" className="sr-only" onChange={onLogo} disabled={uploading} />
            </label>
            {form.logoUrl && (
              <button type="button" onClick={() => set("logoUrl", "")} className="text-sm font-semibold text-basalt/60 hover:text-destructive">
                Remove
              </button>
            )}
          </div>
        </SettingsRow>
        <SettingsRow title="Business name" htmlFor="set-business" help="The name guests see on your listings.">
          <Input id="set-business" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="e.g. Aragats Guesthouse LLC" className="h-12 rounded-none text-base" />
        </SettingsRow>
        <SettingsRow title="Your name" htmlFor="set-name" help="The person behind the account.">
          <Input id="set-name" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} className="h-12 rounded-none text-base" />
        </SettingsRow>
        <SettingsRow title="Bio" htmlFor="set-bio" help="Optional. A few lines for travellers about you or your place.">
          <Textarea id="set-bio" rows={4} value={form.bio} onChange={(e) => set("bio", e.target.value)} placeholder="Tell travellers about your place and what makes it worth the trip." className="rounded-none text-base" />
        </SettingsRow>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {dirty && <span className="text-sm text-basalt/60">You have unsaved changes.</span>}
        {dirty && (
          <button type="button" onClick={() => setForm(initial)} className="h-11 px-3 text-sm font-semibold text-basalt/70 hover:text-basalt">
            Discard
          </button>
        )}
        <button type="submit" disabled={!dirty || saving || uploading} className={primary}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function AccountSettings() {
  const { user, updatePassword, signOut } = useAuth();
  const [, navigate] = useLocation();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast("Use at least 6 characters.");
    if (pw !== pw2) return toast("Those two passwords don't match.");
    setSaving(true);
    try {
      await updatePassword(pw);
      setPw("");
      setPw2("");
      toast.success("Password updated.");
    } catch (err) {
      toast(userMessage(err, "Couldn't update your password."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="divide-y divide-basalt/10 border-y border-basalt/10 py-6">
      <SettingsRow title="Email" help="You sign in with this address. Booking and payout emails go here too.">
        <p className="flex h-12 items-center text-base text-basalt">{user?.email}</p>
      </SettingsRow>
      <SettingsRow title="Password" help="At least 6 characters.">
        <form onSubmit={changePassword} className="grid max-w-md gap-3">
          <label className="grid gap-1.5 text-sm font-semibold">
            New password
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className="h-12 rounded-none text-base font-normal" />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Confirm new password
            <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" className="h-12 rounded-none text-base font-normal" />
          </label>
          <div>
            <button type="submit" disabled={saving || !pw || !pw2} className={primary}>
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </SettingsRow>
      <TelegramConnect variant="row" />
      <SettingsRow title="Sign out" help="Sign out of Revamp on this device.">
        <button
          type="button"
          onClick={async () => {
            await signOut();
            toast("Signed out.");
            navigate("/");
          }}
          className="inline-flex h-11 items-center gap-2 rounded-none border border-basalt/20 px-4 text-sm font-semibold hover:border-basalt/40"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </SettingsRow>
    </div>
  );
}
