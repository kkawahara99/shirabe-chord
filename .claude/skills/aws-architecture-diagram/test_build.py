import os
import pathlib
import tempfile
import unittest
import zipfile

from build import ICONS_DEFAULT_DIR, ICONS_ENV, REPO_ROOT, index_icons, resolve_icons

SVG = '<svg viewBox="0 0 48 48"></svg>'


class ResolveIconsTest(unittest.TestCase):
    def test_引数があれば環境変数や既定より優先する(self):
        arg = pathlib.Path("from-arg")
        self.assertEqual(resolve_icons(arg, {ICONS_ENV: "from-env"}, pathlib.Path("cwd")), arg)

    def test_引数が無ければ環境変数を使う(self):
        self.assertEqual(
            resolve_icons(None, {ICONS_ENV: "from-env"}, pathlib.Path("cwd")), pathlib.Path("from-env")
        )

    def test_環境変数が空や空白だけなら既定の置き場所を使う(self):
        root = pathlib.Path("root")
        self.assertEqual(resolve_icons(None, {ICONS_ENV: ""}, root), root / ICONS_DEFAULT_DIR)
        self.assertEqual(resolve_icons(None, {ICONS_ENV: "  "}, root), root / ICONS_DEFAULT_DIR)

    def test_環境変数のチルダはホームに展開する(self):
        self.assertEqual(
            resolve_icons(None, {ICONS_ENV: "~/icons"}, pathlib.Path("root")), pathlib.Path("~/icons").expanduser()
        )

    def test_どれも無ければリポジトリ直下の既定の置き場所を使う(self):
        root = pathlib.Path("root")
        self.assertEqual(resolve_icons(None, {}, root), root / ICONS_DEFAULT_DIR)

    def test_リポジトリ直下はbuild_pyの3つ上でどこから実行しても変わらない(self):
        self.assertTrue((REPO_ROOT / ".claude" / "skills" / "aws-architecture-diagram" / "build.py").is_file())


class IndexIconsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)

    def make_zip(self, path: pathlib.Path, names: list[str]) -> pathlib.Path:
        with zipfile.ZipFile(path, "w") as archive:
            for name in names:
                archive.writestr(name, SVG)
        return path

    def test_zipを直接渡すとアイコン名で引ける(self):
        zip_path = self.make_zip(self.root / "icons.zip", ["Architecture/Arch_A_48.svg"])
        self.assertIn("Arch_A_48", index_icons(zip_path))

    def test_展開したディレクトリを渡すとアイコン名で引ける(self):
        (self.root / "sub").mkdir()
        (self.root / "sub" / "Arch_B_48.svg").write_text(SVG, encoding="utf-8")
        self.assertIn("Arch_B_48", index_icons(self.root))

    def test_zipだけが入ったディレクトリを渡すとzipの中のアイコンを引ける(self):
        self.make_zip(self.root / "icons.zip", ["Arch_C_48.svg"])
        self.assertIn("Arch_C_48", index_icons(self.root))

    def test_zipが複数あれば新しい方を使う(self):
        old = self.make_zip(self.root / "old.zip", ["Arch_Old_48.svg"])
        new = self.make_zip(self.root / "new.zip", ["Arch_New_48.svg"])
        os.utime(old, (1_000_000_000, 1_000_000_000))
        os.utime(new, (2_000_000_000, 2_000_000_000))
        icons = index_icons(self.root)
        self.assertIn("Arch_New_48", icons)
        self.assertNotIn("Arch_Old_48", icons)

    def test_存在しない場所は置き場所を案内して止まる(self):
        self.assert_guides_to_placement(self.root / "missing")

    def test_空のディレクトリも置き場所を案内して止まる(self):
        self.assert_guides_to_placement(self.root)

    def test_MACOSXの下のsvgだけならzipの方を使う(self):
        (self.root / "__MACOSX").mkdir()
        (self.root / "__MACOSX" / "Arch_Junk_48.svg").write_text(SVG, encoding="utf-8")
        self.make_zip(self.root / "icons.zip", ["Arch_D_48.svg"])
        icons = index_icons(self.root)
        self.assertIn("Arch_D_48", icons)
        self.assertNotIn("Arch_Junk_48", icons)

    def assert_guides_to_placement(self, source: pathlib.Path):
        with self.assertRaises(SystemExit) as raised:
            index_icons(source)
        message = str(raised.exception)
        self.assertIn(str(ICONS_DEFAULT_DIR), message)
        self.assertIn(ICONS_ENV, message)


if __name__ == "__main__":
    unittest.main()
