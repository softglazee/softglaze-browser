// softglaze_store.node: the Microsoft Store build's bridge to Windows.Services.Store (C++/WinRT,
// Node-API). Built by scripts/build-store-native.js and shipped ONLY in the Store package
// (resources/store-native/softglaze_store.node); the website and base installers never load it.
//
// Why an in-process addon: StoreContext needs the app's package identity, which the Electron main
// process has (it is the package's Application). A helper .exe started from the app would need extra
// manifest entries to get that identity. Node-API is ABI-stable, so Electron upgrades need no rebuild.
//
// One export:  call(cmd: string, opts: object) -> Promise<string>  (a JSON text)
//   ping                                  {ok, protocol, packaged, packageFamilyName}
//   license                               {ok, app:{...}, addOns:[{key, skuStoreId, inAppOfferToken, isActive, expiresAtMs}]}
//   products                              {ok, products:[{storeId, inAppOfferToken, title, productKind, price, skus}], extendedError}
//   purchase  {storeId, hwnd}             {ok, status: Succeeded|AlreadyPurchased|NotPurchased|NetworkError|ServerError, extendedError}
//   keys      {collectionsTicket, purchaseTicket, publisherUserId}   {ok, collectionsKey, purchaseKey}
// A failure resolves (never rejects) with {ok:false, error, hresult, message}.
//
// Every Store operation is STARTED on the calling thread, which in the app is Electron's UI thread,
// with the app window set as the owner (IInitializeWithWindow), as Microsoft requires for desktop
// apps. Completion arrives on a thread-pool thread and is handed back to JavaScript through a
// thread-safe function, so the UI thread is never blocked.

#include <windows.h>
#include <unknwn.h>
#include <shobjidl_core.h>
#include <appmodel.h>
#include <node_api.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Services.Store.h>

using winrt::hstring;
using winrt::Windows::Foundation::AsyncStatus;
using winrt::Windows::Foundation::DateTime;
using namespace winrt::Windows::Services::Store;

namespace {

constexpr int kProtocol = 1;

// ---- tiny JSON writer (UTF-8) -------------------------------------------------------------------
std::string q(std::string const& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
                else o += static_cast<char>(c);
        }
    }
    return o + "\"";
}
std::string q(hstring const& h) { return q(winrt::to_string(h)); }
std::string b(bool v) { return v ? "true" : "false"; }
std::string n(int64_t v) { return std::to_string(v); }

std::string hex32(int32_t v) {
    char buf[16];
    snprintf(buf, sizeof buf, "0x%08X", static_cast<uint32_t>(v));
    return buf;
}

// DateTime counts 100 ns ticks since 1601-01-01 UTC; JavaScript wants milliseconds since 1970.
int64_t to_ms(DateTime const& dt) {
    constexpr int64_t kTicksTo1970 = 116444736000000000LL;
    return (dt.time_since_epoch().count() - kTicksTo1970) / 10000;
}

std::string error_json(char const* code, int32_t hr, std::string const& message) {
    return "{\"ok\":false,\"error\":" + q(std::string(code)) + ",\"hresult\":" + q(hex32(hr)) + ",\"message\":" + q(message) + "}";
}

std::string error_json(winrt::hresult_error const& e) {
    return error_json("winrt", e.code(), winrt::to_string(e.message()));
}

char const* unit_name(StoreDurationUnit u) {
    switch (u) {
        case StoreDurationUnit::Minute: return "minute";
        case StoreDurationUnit::Hour: return "hour";
        case StoreDurationUnit::Day: return "day";
        case StoreDurationUnit::Week: return "week";
        case StoreDurationUnit::Month: return "month";
        case StoreDurationUnit::Year: return "year";
        default: return "unknown";
    }
}

char const* purchase_status_name(StorePurchaseStatus s) {
    switch (s) {
        case StorePurchaseStatus::Succeeded: return "Succeeded";
        case StorePurchaseStatus::AlreadyPurchased: return "AlreadyPurchased";
        case StorePurchaseStatus::NotPurchased: return "NotPurchased";
        case StorePurchaseStatus::NetworkError: return "NetworkError";
        case StorePurchaseStatus::ServerError: return "ServerError";
        default: return "Unknown";
    }
}

std::string price_json(StorePrice const& p) {
    return "{\"formatted\":" + q(p.FormattedPrice()) + ",\"formattedBase\":" + q(p.FormattedBasePrice())
        + ",\"formattedRecurrence\":" + q(p.FormattedRecurrencePrice()) + ",\"currencyCode\":" + q(p.CurrencyCode()) + "}";
}

// StoreLicense.IsActive is documented as "reserved for future use... always returns true"; an add-on
// whose licence ended is simply absent from AddOnLicenses. Both facts go to JavaScript as read.
std::string license_json(StoreAppLicense const& lic) {
    std::string s = "{\"ok\":true,\"app\":{\"isActive\":" + b(lic.IsActive()) + ",\"isTrial\":" + b(lic.IsTrial())
        + ",\"skuStoreId\":" + q(lic.SkuStoreId()) + ",\"expiresAtMs\":" + n(to_ms(lic.ExpirationDate())) + "},\"addOns\":[";
    bool first = true;
    for (auto const& kv : lic.AddOnLicenses()) {
        StoreLicense a = kv.Value();
        if (!first) s += ",";
        first = false;
        s += "{\"key\":" + q(kv.Key()) + ",\"skuStoreId\":" + q(a.SkuStoreId()) + ",\"inAppOfferToken\":" + q(a.InAppOfferToken())
            + ",\"isActive\":" + b(a.IsActive()) + ",\"expiresAtMs\":" + n(to_ms(a.ExpirationDate())) + "}";
    }
    return s + "]}";
}

std::string products_json(StoreProductQueryResult const& r) {
    std::string s = "{\"ok\":true,\"products\":[";
    bool first = true;
    for (auto const& kv : r.Products()) {
        StoreProduct p = kv.Value();
        if (!first) s += ",";
        first = false;
        s += "{\"storeId\":" + q(p.StoreId()) + ",\"inAppOfferToken\":" + q(p.InAppOfferToken()) + ",\"title\":" + q(p.Title())
            + ",\"productKind\":" + q(p.ProductKind()) + ",\"price\":" + price_json(p.Price()) + ",\"skus\":[";
        bool firstSku = true;
        for (auto const& sku : p.Skus()) {
            if (!firstSku) s += ",";
            firstSku = false;
            s += "{\"storeId\":" + q(sku.StoreId()) + ",\"isSubscription\":" + b(sku.IsSubscription()) + ",\"price\":" + price_json(sku.Price());
            if (sku.IsSubscription()) {
                StoreSubscriptionInfo info = sku.SubscriptionInfo();
                s += ",\"subscription\":{\"billingPeriod\":" + n(info.BillingPeriod()) + ",\"billingPeriodUnit\":" + q(std::string(unit_name(info.BillingPeriodUnit())))
                    + ",\"hasTrialPeriod\":" + b(info.HasTrialPeriod()) + ",\"trialPeriod\":" + n(info.TrialPeriod())
                    + ",\"trialPeriodUnit\":" + q(std::string(unit_name(info.TrialPeriodUnit()))) + "}";
            }
            s += "}";
        }
        s += "]}";
    }
    return s + "],\"extendedError\":" + q(hex32(r.ExtendedError())) + "}";
}

bool package_family(std::string& family) {
    UINT32 len = 0;
    LONG rc = GetCurrentPackageFamilyName(&len, nullptr);
    if (rc != ERROR_INSUFFICIENT_BUFFER || len == 0) return false;
    std::wstring buf(len, L'\0');
    rc = GetCurrentPackageFamilyName(&len, buf.data());
    if (rc != ERROR_SUCCESS) return false;
    if (!buf.empty() && buf.back() == L'\0') buf.pop_back();
    family = winrt::to_string(buf);
    return true;
}

// The UI thread in Electron already has COM; plain Node (the build check) may not. Any result is fine:
// S_OK/S_FALSE keep a reference for the thread's life, RPC_E_CHANGED_MODE means it is already set up.
void ensure_com() {
    static bool done = false;
    if (done) return;
    done = true;
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
}

// ---- Node-API plumbing ----------------------------------------------------------------------------
struct Job {
    napi_deferred deferred = nullptr;
    napi_threadsafe_function tsfn = nullptr;
};

void call_js(napi_env env, napi_value /*js_cb*/, void* context, void* data) {
    auto* job = static_cast<Job*>(context);
    std::unique_ptr<std::string> payload(static_cast<std::string*>(data));
    if (!env || !payload) return;
    napi_value v;
    napi_create_string_utf8(env, payload->c_str(), payload->size(), &v);
    napi_resolve_deferred(env, job->deferred, v);
}

void finalize_job(napi_env /*env*/, void* data, void* /*hint*/) { delete static_cast<Job*>(data); }

// Called once per job from any thread: hands the JSON to the JavaScript thread and frees the job.
void finish(Job* job, std::string json) {
    auto* payload = new std::string(std::move(json));
    if (napi_call_threadsafe_function(job->tsfn, payload, napi_tsfn_blocking) != napi_ok) delete payload;
    napi_release_threadsafe_function(job->tsfn, napi_tsfn_release);
}

std::string get_string(napi_env env, napi_value obj, char const* name) {
    if (!obj) return {};
    bool has = false;
    if (napi_has_named_property(env, obj, name, &has) != napi_ok || !has) return {};
    napi_value v;
    if (napi_get_named_property(env, obj, name, &v) != napi_ok) return {};
    napi_valuetype t;
    napi_typeof(env, v, &t);
    if (t != napi_string) return {};
    size_t len = 0;
    napi_get_value_string_utf8(env, v, nullptr, 0, &len);
    std::string s(len, '\0');
    napi_get_value_string_utf8(env, v, s.data(), len + 1, &len);
    return s;
}

StoreContext make_context(std::string const& hwndText) {
    StoreContext ctx = StoreContext::GetDefault();
    if (!hwndText.empty()) {
        HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(hwndText)));
        if (!IsWindow(hwnd)) throw winrt::hresult_invalid_argument(L"invalid_window");
        auto init = ctx.as<::IInitializeWithWindow>();
        winrt::check_hresult(init->Initialize(hwnd));
    }
    return ctx;
}

// One async Store operation -> JSON through `render`.
template <typename TOp, typename TRender>
void complete_with(Job* job, TOp const& op, TRender render) {
    op.Completed([job, render](auto const& done, AsyncStatus) {
        std::string json;
        try { json = render(done.GetResults()); }
        catch (winrt::hresult_error const& e) { json = error_json(e); }
        catch (std::exception const& e) { json = error_json("exception", E_FAIL, e.what()); }
        catch (...) { json = error_json("exception", E_FAIL, "Unknown error."); }
        finish(job, std::move(json));
    });
}

// Both Store ID keys, requested together; the job finishes when the second one arrives.
struct KeysState {
    std::mutex m;
    std::string collections, purchase, error;
    std::atomic<int> left{ 2 };
};

void key_done(Job* job, std::shared_ptr<KeysState> st, bool isCollections, std::string value, std::string err) {
    {
        std::lock_guard<std::mutex> lock(st->m);
        if (!err.empty() && st->error.empty()) st->error = err;
        (isCollections ? st->collections : st->purchase) = std::move(value);
    }
    if (--st->left == 0) {
        finish(job, st->error.empty()
            ? "{\"ok\":true,\"collectionsKey\":" + q(st->collections) + ",\"purchaseKey\":" + q(st->purchase) + "}"
            : st->error);
    }
}

template <typename TOp>
void key_op(Job* job, std::shared_ptr<KeysState> st, bool isCollections, TOp const& op) {
    op.Completed([job, st, isCollections](auto const& done, AsyncStatus) {
        try { key_done(job, st, isCollections, winrt::to_string(done.GetResults()), {}); }
        catch (winrt::hresult_error const& e) { key_done(job, st, isCollections, {}, error_json(e)); }
        catch (...) { key_done(job, st, isCollections, {}, error_json("exception", E_FAIL, "Unknown error.")); }
    });
}

napi_value resolved(napi_env env, napi_deferred d, napi_value promise, std::string const& json) {
    napi_value v;
    napi_create_string_utf8(env, json.c_str(), json.size(), &v);
    napi_resolve_deferred(env, d, v);
    return promise;
}

napi_value Call(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2] = { nullptr, nullptr };
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);

    std::string cmd;
    if (argc >= 1) {
        size_t len = 0;
        napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);
        cmd.resize(len);
        napi_get_value_string_utf8(env, argv[0], cmd.data(), len + 1, &len);
    }
    napi_value opts = argc >= 2 ? argv[1] : nullptr;
    if (opts) {
        napi_valuetype t;
        napi_typeof(env, opts, &t);
        if (t != napi_object) opts = nullptr;
    }

    std::string family;
    bool packaged = package_family(family);
    if (cmd == "ping") {
        return resolved(env, deferred, promise, "{\"ok\":true,\"protocol\":" + n(kProtocol) + ",\"packaged\":" + b(packaged)
            + ",\"packageFamilyName\":" + q(packaged ? family : std::string()) + "}");
    }
    if (!packaged) {
        return resolved(env, deferred, promise, error_json("no_package_identity", APPMODEL_ERROR_NO_PACKAGE, "Store purchases only work in the Microsoft Store version of the app."));
    }
    if (cmd != "license" && cmd != "products" && cmd != "purchase" && cmd != "keys") {
        return resolved(env, deferred, promise, error_json("unknown_command", E_INVALIDARG, "Unknown command."));
    }

    auto* job = new Job();
    job->deferred = deferred;
    napi_value name;
    napi_create_string_utf8(env, "softglaze_store", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, job, finalize_job, job, call_js, &job->tsfn) != napi_ok) {
        delete job;
        return resolved(env, deferred, promise, error_json("exception", E_FAIL, "Could not start the Store call."));
    }

    try {
        ensure_com();
        StoreContext ctx = make_context(get_string(env, opts, "hwnd"));
        if (cmd == "license") {
            complete_with(job, ctx.GetAppLicenseAsync(), [](StoreAppLicense const& r) { return license_json(r); });
        } else if (cmd == "products") {
            auto kinds = winrt::single_threaded_vector<hstring>({ L"Durable" });
            complete_with(job, ctx.GetAssociatedStoreProductsAsync(kinds), [](StoreProductQueryResult const& r) { return products_json(r); });
        } else if (cmd == "purchase") {
            std::string storeId = get_string(env, opts, "storeId");
            if (storeId.empty() || get_string(env, opts, "hwnd").empty()) throw winrt::hresult_invalid_argument(L"storeId and hwnd are required");
            complete_with(job, ctx.RequestPurchaseAsync(winrt::to_hstring(storeId)), [](StorePurchaseResult const& r) {
                return "{\"ok\":true,\"status\":" + q(std::string(purchase_status_name(r.Status()))) + ",\"extendedError\":" + q(hex32(r.ExtendedError())) + "}";
            });
        } else {
            std::string ct = get_string(env, opts, "collectionsTicket");
            std::string pt = get_string(env, opts, "purchaseTicket");
            hstring user = winrt::to_hstring(get_string(env, opts, "publisherUserId"));
            if (ct.empty() || pt.empty()) throw winrt::hresult_invalid_argument(L"collectionsTicket and purchaseTicket are required");
            auto st = std::make_shared<KeysState>();
            key_op(job, st, true, ctx.GetCustomerCollectionsIdAsync(winrt::to_hstring(ct), user));
            key_op(job, st, false, ctx.GetCustomerPurchaseIdAsync(winrt::to_hstring(pt), user));
        }
    } catch (winrt::hresult_error const& e) {
        std::wstring msg(e.message());
        finish(job, msg == L"invalid_window" ? error_json("invalid_window", e.code(), "The app window is not available.") : error_json(e));
    } catch (std::exception const& e) {
        finish(job, error_json("exception", E_FAIL, e.what()));
    }
    return promise;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "call", NAPI_AUTO_LENGTH, Call, nullptr, &fn);
    napi_set_named_property(env, exports, "call", fn);
    napi_value proto;
    napi_create_int32(env, kProtocol, &proto);
    napi_set_named_property(env, exports, "protocol", proto);
    return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
