/**
 * Виджет «Очередь ответственных» для amoCRM.
 *
 * Здесь только окно настроек: выбор сотрудников и порядка очереди. Сам
 * выбор хранится в amoCRM — в скрытом поле `rr_config` (тип custom, JSON
 * {"users": [id, …], "skip_manual": bool}). Назначает ответственных сервер
 * (папка server/): amoCRM присылает ему вебхук о новой сделке, сервер
 * читает эти настройки через API и ставит следующего по очереди.
 *
 * SERVER_URL подставляет scripts/build-widget.sh при сборке архива.
 */
define(["jquery"], function ($) {
  var SERVER_URL = "__SERVER_URL__";
  var FIELD = "rr_config";

  var CustomWidget = function () {
    var self = this;
    var state = { users: [], skipManual: false };
    var $root = null;
    var lastStatus = null;

    function parseConfig(raw) {
      var v = raw;
      if (typeof v === "string") {
        try {
          v = JSON.parse(v);
        } catch (e) {
          v = null;
        }
      }
      var users = [];
      if (v && $.isArray(v.users)) {
        $.each(v.users, function (_, u) {
          var id = parseInt(u, 10);
          if (id > 0 && $.inArray(id, users) < 0) users.push(id);
        });
      }
      return {
        users: users,
        skipManual: !!(v && (v.skip_manual === true || v.skip_manual === "Y")),
      };
    }

    /** Пользователи аккаунта: { id: {id, title, active, …} } → [{id, name, active}]. */
    function managers() {
      var raw = {};
      try {
        raw = (window.APP || window.AMOCRM).constant("managers") || {};
      } catch (e) {
        raw = {};
      }
      var list = [];
      $.each(raw, function (key, m) {
        var id = parseInt((m && m.id) || key, 10);
        if (!(id > 0)) return;
        var active = !(
          m.active === false ||
          m.active === "N" ||
          m.active === 0 ||
          m.active === "0"
        );
        list.push({
          id: id,
          name: m.title || m.name || m.login || "Пользователь " + id,
          active: active,
        });
      });
      list.sort(function (a, b) {
        return a.name.localeCompare(b.name, "ru");
      });
      return list;
    }

    function userName(id) {
      var found = null;
      $.each(managers(), function (_, m) {
        if (m.id === id) found = m;
      });
      return found ? found.name : "Пользователь " + id;
    }

    function $hidden() {
      return $('input[name="' + FIELD + '"]');
    }

    /** Записать выбор в скрытое поле — amoCRM сохранит его по кнопке «Сохранить». */
    function commit() {
      $hidden()
        .val(JSON.stringify({ users: state.users, skip_manual: state.skipManual }))
        .trigger("change");
      render();
    }

    function injectStyle() {
      if ($("#rr-queue-style").length) return;
      $("head").append(
        '<style id="rr-queue-style">' +
          ".rr-queue{font-size:14px;line-height:1.45;margin-top:8px}" +
          ".rr-queue h3{font-size:15px;font-weight:600;margin:16px 0 8px}" +
          ".rr-queue .rr-hint{color:#6b7280;font-size:13px;margin:4px 0 8px}" +
          ".rr-queue ol{margin:0;padding:0;list-style:none;counter-reset:rr}" +
          ".rr-queue li.rr-user{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;background:#fff}" +
          ".rr-queue li.rr-user:before{counter-increment:rr;content:counter(rr);min-width:20px;color:#9ca3af;font-variant-numeric:tabular-nums}" +
          ".rr-queue li.rr-user .rr-name{flex:1}" +
          ".rr-queue li.rr-next{border-color:#3b82f6}" +
          ".rr-queue .rr-tag{font-size:12px;color:#2563eb}" +
          ".rr-queue .rr-warn{color:#b45309}" +
          ".rr-queue .rr-err{color:#b91c1c}" +
          ".rr-queue .rr-ok{color:#15803d}" +
          ".rr-queue button.rr-btn{border:1px solid #d1d5db;background:#f9fafb;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:13px}" +
          ".rr-queue button.rr-btn:disabled{opacity:.4;cursor:default}" +
          ".rr-queue .rr-add{display:flex;gap:8px;margin-top:8px}" +
          ".rr-queue .rr-add select{flex:1;min-width:0;padding:4px}" +
          ".rr-queue label.rr-check{display:flex;gap:8px;align-items:flex-start;margin-top:12px;cursor:pointer}" +
          ".rr-queue table{border-collapse:collapse;width:100%;font-size:13px}" +
          ".rr-queue td{padding:3px 6px 3px 0;border-bottom:1px solid #f3f4f6;vertical-align:top}" +
          ".rr-queue code{word-break:break-all;background:#f3f4f6;padding:1px 4px;border-radius:3px}" +
          "</style>",
      );
    }

    function render() {
      if (!$root) return;
      var all = managers();
      var nextId = lastStatus && lastStatus.connected ? lastStatus.nextUserId : null;
      var inactive = (lastStatus && lastStatus.inactive) || [];
      $root.empty();

      $root.append($("<h3>").text("Кто получает новые сделки"));
      $root.append(
        $('<div class="rr-hint">').text(
          "Новые сделки распределяются по очереди сверху вниз: первая — первому, вторая — второму, после последнего — снова с начала. Пользователи не из списка новых сделок не получают.",
        ),
      );

      var $list = $("<ol>");
      $.each(state.users, function (i, id) {
        var $li = $('<li class="rr-user">');
        if (id === nextId) $li.addClass("rr-next");
        $li.append($('<span class="rr-name">').text(userName(id)));
        if (id === nextId) $li.append($('<span class="rr-tag">').text("следующий"));
        if ($.inArray(id, inactive) >= 0) {
          $li.append($('<span class="rr-warn">').text("отключён в amoCRM — пропускается"));
        }
        $li.append(
          $('<button type="button" class="rr-btn" title="Выше">↑</button>')
            .prop("disabled", i === 0)
            .on("click", function () {
              state.users.splice(i, 1);
              state.users.splice(i - 1, 0, id);
              commit();
            }),
          $('<button type="button" class="rr-btn" title="Ниже">↓</button>')
            .prop("disabled", i === state.users.length - 1)
            .on("click", function () {
              state.users.splice(i, 1);
              state.users.splice(i + 1, 0, id);
              commit();
            }),
          $('<button type="button" class="rr-btn" title="Убрать из очереди">✕</button>').on(
            "click",
            function () {
              state.users.splice(i, 1);
              commit();
            },
          ),
        );
        $list.append($li);
      });
      if (!state.users.length) {
        $root.append(
          $('<div class="rr-warn">').text(
            "Очередь пуста — новые сделки распределяться не будут. Добавьте сотрудников.",
          ),
        );
      }
      $root.append($list);

      var $select = $("<select>");
      $select.append($('<option value="">').text("— выберите сотрудника —"));
      $.each(all, function (_, m) {
        if (!m.active || $.inArray(m.id, state.users) >= 0) return;
        $select.append($("<option>").val(String(m.id)).text(m.name));
      });
      var $add = $('<button type="button" class="rr-btn">Добавить</button>').on(
        "click",
        function () {
          var id = parseInt($select.val(), 10);
          if (id > 0 && $.inArray(id, state.users) < 0) {
            state.users.push(id);
            commit();
          }
        },
      );
      $root.append($('<div class="rr-add">').append($select, $add));

      var $check = $('<input type="checkbox">')
        .prop("checked", state.skipManual)
        .on("change", function () {
          state.skipManual = $(this).is(":checked");
          commit();
        });
      $root.append(
        $('<label class="rr-check">').append(
          $check,
          $("<span>").text(
            "Не трогать сделки, которые сотрудник создал вручную — распределять только входящие заявки (сайт, формы, почта, мессенджеры, «Неразобранное»).",
          ),
        ),
      );

      $root.append(
        $('<div class="rr-hint">').text("Изменения начинают действовать после кнопки «Сохранить»."),
      );

      renderStatus();
    }

    function renderStatus() {
      var $box = $('<div class="rr-status">');
      $root.append($("<h3>").text("Состояние"), $box);
      if (!lastStatus) {
        $box.append($('<div class="rr-hint">').text("Проверяем связь с сервером…"));
        return;
      }
      if (lastStatus.error) {
        $box.append($('<div class="rr-err">').text(lastStatus.error));
        return;
      }
      if (!lastStatus.connected) {
        $box.append(
          $('<div class="rr-err">').text(
            "Сервер очереди не знает этот аккаунт — сделки не распределяются. Отключите интеграцию и установите её заново (amoCRM → Настройки → Интеграции), чтобы выдать доступ.",
          ),
        );
        return;
      }
      if (lastStatus.webhookError) {
        $box.append(
          $('<div class="rr-err">').text(
            "amoCRM не дал подписаться на новые сделки: " + lastStatus.webhookError,
          ),
          $('<div class="rr-hint">').text(
            "Подписка на вебхуки через API есть на тарифах «Расширенный» и «Профессиональный». Можно добавить вебхук вручную: Настройки → Интеграции → Веб-хуки, адрес ниже, события «Сделка добавлена» и «Смена этапа сделки».",
          ),
          $("<div>").append($("<code>").text(lastStatus.webhookUrl || "")),
          $(
            '<button type="button" class="rr-btn" style="margin-top:8px">Повторить подписку</button>',
          ).on("click", function () {
            call("POST", "/api/resubscribe");
          }),
        );
      } else {
        $box.append(
          $('<div class="rr-ok">').text("Подключено: новые сделки поступают на сервер очереди."),
        );
      }
      if (lastStatus.settingsError) {
        $box.append(
          $('<div class="rr-err">').text(
            "Не удалось прочитать настройки: " + lastStatus.settingsError,
          ),
        );
      }

      var recent = lastStatus.recent || [];
      if (!recent.length) {
        $box.append($('<div class="rr-hint">').text("Сделок пока не было."));
        return;
      }
      var labels = { assigned: "", skipped: "не назначен", failed: "ошибка" };
      var $table = $("<table>");
      $.each(recent, function (_, a) {
        var when = new Date(a.createdAt * 1000);
        var whenText =
          ("0" + when.getDate()).slice(-2) +
          "." +
          ("0" + (when.getMonth() + 1)).slice(-2) +
          " " +
          ("0" + when.getHours()).slice(-2) +
          ":" +
          ("0" + when.getMinutes()).slice(-2);
        var $who = $("<td>");
        if (a.userId) $who.text(userName(a.userId));
        if (a.status !== "assigned" || a.note) {
          $who.append(
            $("<div>")
              .addClass(a.status === "failed" ? "rr-err" : "rr-hint")
              .text([labels[a.status], a.note].filter(Boolean).join(": ")),
          );
        }
        $table.append(
          $("<tr>").append(
            $("<td>").text(whenText),
            $("<td>").append(
              $('<a target="_blank">')
                .attr("href", "/leads/detail/" + a.leadId)
                .text("Сделка " + a.leadId),
            ),
            $who,
          ),
        );
      });
      $box.append($('<div class="rr-hint">').text("Последние сделки:"), $table);
    }

    /** Запрос к серверу с одноразовым токеном amoCRM (заголовок X-Auth-Token). */
    function call(method, path) {
      if (!self.$authorizedAjax) {
        lastStatus = { error: "Эта версия amoCRM не поддерживает запросы виджета к серверу." };
        render();
        return $.Deferred().reject().promise();
      }
      return self
        .$authorizedAjax({ url: SERVER_URL + path, type: method, method: method, dataType: "json" })
        .done(function (data) {
          lastStatus = data;
          render();
        })
        .fail(function () {
          lastStatus = {
            error:
              "Сервер очереди не отвечает (" +
              SERVER_URL +
              "). Если виджет только что установлен — откройте настройки ещё раз через минуту.",
          };
          render();
        });
    }

    this.callbacks = {
      render: function () {
        return true;
      },
      init: function () {
        return true;
      },
      bind_actions: function () {
        return true;
      },
      settings: function ($modal_body) {
        injectStyle();
        var saved = (self.get_settings() || {})[FIELD];
        state = parseConfig($hidden().val() || saved);
        var code = (self.get_settings() || {}).widget_code || (self.params || {}).widget_code;
        var $holder = code ? $modal_body.find("#" + code + "_custom_content") : $();
        if (!$holder.length) $holder = $modal_body.find(".widget_settings_block");
        $root = $('<div class="rr-queue">');
        $holder.append($root);
        lastStatus = null;
        render();
        call("GET", "/api/status");
        return true;
      },
      onSave: function () {
        // Сервер держит настройки в кэше 10 секунд — сбросим, чтобы новая
        // очередь работала сразу. Сохранение в amoCRM от ответа не зависит.
        var d = $.Deferred();
        if (self.$authorizedAjax) {
          self
            .$authorizedAjax({
              url: SERVER_URL + "/api/saved",
              type: "POST",
              method: "POST",
              dataType: "json",
            })
            .always(function () {
              d.resolve(true);
            });
        } else {
          d.resolve(true);
        }
        return d.promise();
      },
      destroy: function () {
        $root = null;
      },
      onInstall: function () {
        return true;
      },
    };
    return this;
  };

  return CustomWidget;
});
