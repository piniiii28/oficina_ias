# Complemento de Blender: conecta Blender con la Oficina de IAs.
#
# Abre un pequeño servidor solo en tu computador (127.0.0.1) para que la
# oficina pueda ver la escena, ejecutar pasos de modelado, tomar capturas y
# guardar el proyecto. Cada mensaje trae una clave secreta propia de tu
# oficina, así que ningún otro programa lo puede usar. La oficina, además, te
# pide permiso antes de que una IA toque tu escena.
bl_info = {
    "name": "Oficina de IAs",
    "author": "Oficina de IAs",
    "version": (1, 0, 0),
    "blender": (3, 2, 0),
    "location": "Vista 3D > Barra lateral (N) > Oficina",
    "description": "Deja que las IAs de la Oficina modelen en vivo en tu Blender (con tu permiso)",
    "category": "3D View",
}

import base64
import contextlib
import io
import json
import os
import queue
import socket
import tempfile
import threading
import time
import traceback

import bpy

TOKEN = "__TOKEN__"
PORT = __PORT__

_state = {"server": None, "running": False, "last": "", "count": 0}
_jobs = queue.Queue()


def _r(v):
    return [round(x, 4) for x in v]


def _scene():
    objs = []
    for o in bpy.context.scene.objects:
        d = {
            "nombre": o.name,
            "tipo": o.type,
            "ubicacion": _r(o.location),
            "rotacion": _r(o.rotation_euler),
            "escala": _r(o.scale),
            "dimensiones": _r(o.dimensions),
            "modificadores": [m.type for m in o.modifiers],
            "materiales": [s.material.name for s in o.material_slots if s.material],
            "visible": o.visible_get(),
        }
        if o.type == "MESH":
            d["caras"] = len(o.data.polygons)
        objs.append(d)
    us = bpy.context.scene.unit_settings
    return {
        "ok": True,
        "archivo": bpy.data.filepath or "(sin guardar)",
        "unidades": us.system,
        "escala_unidades": us.scale_length,
        "objetos": objs[:200],
        "seleccion": [o.name for o in bpy.context.selected_objects],
        "activo": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
    }


def _view3d():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                return window, area
    return None, None


def _handle(msg):
    cmd = msg.get("cmd")
    if cmd == "ping":
        return {"ok": True, "version": bpy.app.version_string, "archivo": bpy.data.filepath or "(sin guardar)"}
    if cmd == "escena":
        return _scene()
    if cmd == "ejecutar":
        buf = io.StringIO()
        env = {"bpy": bpy, "__name__": "__oficina__"}
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(msg.get("codigo", ""), "<oficina>", "exec"), env)
            return {"ok": True, "salida": buf.getvalue()[-8000:]}
        except Exception:
            return {"ok": False, "salida": buf.getvalue()[-4000:], "error": traceback.format_exc()[-4000:]}
    if cmd == "captura":
        window, area = _view3d()
        if not area:
            return {"ok": False, "error": "No hay una vista 3D abierta"}
        path = os.path.join(tempfile.gettempdir(), "oficina_blender_captura.png")
        with bpy.context.temp_override(window=window, area=area):
            bpy.ops.screen.screenshot_area(filepath=path)
        with open(path, "rb") as f:
            return {"ok": True, "png": base64.b64encode(f.read()).decode()}
    if cmd == "guardar":
        bpy.ops.wm.save_as_mainfile(filepath=msg["ruta"], copy=bool(msg.get("copia")))
        return {"ok": True, "archivo": msg["ruta"]}
    if cmd == "exportar_stl":
        ruta = msg["ruta"]
        bpy.ops.object.select_all(action="DESELECT")
        for o in bpy.context.scene.objects:
            if o.type == "MESH" and o.visible_get():
                o.select_set(True)
        if hasattr(bpy.ops.wm, "stl_export"):
            bpy.ops.wm.stl_export(filepath=ruta, export_selected_objects=True, global_scale=float(msg.get("escala", 1000)))
        else:
            bpy.ops.export_mesh.stl(filepath=ruta, use_selection=True, global_scale=float(msg.get("escala", 1000)))
        return {"ok": True, "archivo": ruta}
    return {"ok": False, "error": "Orden desconocida: %s" % cmd}


def _tick():
    """Ejecuta en el hilo principal de Blender lo que llega de la oficina."""
    while not _jobs.empty():
        msg, box, done = _jobs.get()
        try:
            box["res"] = _handle(msg)
        except Exception:
            box["res"] = {"ok": False, "error": traceback.format_exc()[-4000:]}
        _state["count"] += 1
        _state["last"] = msg.get("cmd", "")
        done.set()
    return 0.1 if _state["running"] else None


def _serve(sock):
    while _state["running"]:
        try:
            conn, _ = sock.accept()
        except OSError:
            break
        threading.Thread(target=_client, args=(conn,), daemon=True).start()


def _client(conn):
    with conn:
        conn.settimeout(300)
        data = b""
        try:
            while not data.endswith(b"\n"):
                chunk = conn.recv(65536)
                if not chunk:
                    return
                data += chunk
            msg = json.loads(data.decode("utf-8"))
            if msg.get("token") != TOKEN:
                res = {"ok": False, "error": "Clave incorrecta"}
            else:
                box, done = {}, threading.Event()
                _jobs.put((msg, box, done))
                res = box["res"] if done.wait(240) else {"ok": False, "error": "Blender está ocupado"}
            conn.sendall((json.dumps(res) + "\n").encode("utf-8"))
        except Exception as e:
            try:
                conn.sendall((json.dumps({"ok": False, "error": str(e)}) + "\n").encode("utf-8"))
            except OSError:
                pass


def start():
    if _state["running"]:
        return None
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", PORT))
    except OSError as e:
        print("[Oficina de IAs] No pude abrir el puerto %d: %s" % (PORT, e))
        return None
    sock.listen(4)
    _state["server"] = sock
    _state["running"] = True
    threading.Thread(target=_serve, args=(sock,), daemon=True).start()
    bpy.app.timers.register(_tick, persistent=True)
    print("[Oficina de IAs] Conectado en el puerto %d" % PORT)
    return None


def stop():
    _state["running"] = False
    if _state["server"]:
        try:
            _state["server"].close()
        except OSError:
            pass
        _state["server"] = None


class OFICINA_OT_conectar(bpy.types.Operator):
    bl_idname = "oficina.conectar"
    bl_label = "Conectar con la oficina"

    def execute(self, context):
        start()
        return {"FINISHED"}


class OFICINA_OT_desconectar(bpy.types.Operator):
    bl_idname = "oficina.desconectar"
    bl_label = "Desconectar"

    def execute(self, context):
        stop()
        return {"FINISHED"}


class OFICINA_PT_panel(bpy.types.Panel):
    bl_label = "Oficina de IAs"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Oficina"

    def draw(self, context):
        col = self.layout.column()
        if _state["running"]:
            col.label(text="Conectado a la oficina", icon="CHECKMARK")
            col.label(text="Órdenes recibidas: %d" % _state["count"])
            col.operator("oficina.desconectar", icon="CANCEL")
        else:
            col.label(text="Desconectado", icon="ERROR")
            col.operator("oficina.conectar", icon="LINKED")


CLASSES = (OFICINA_OT_conectar, OFICINA_OT_desconectar, OFICINA_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    # Arranca solo, un segundo después de abrir Blender (sin frenar el inicio).
    if not bpy.app.background:
        bpy.app.timers.register(start, first_interval=1.0)


def unregister():
    stop()
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
