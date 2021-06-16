project('annex',
          version: '0.1.0',
    meson_version: '>= 0.50.0',
  default_options: [ 'warning_level=2' ],
)

i18n = import('i18n')
gnome = import('gnome')

application_id = 'ca.andyholmes.Annex'
application_path = '/ca/andyholmes/Annex'

# Directories
prefix = get_option('prefix')
bindir = join_paths(prefix, get_option('bindir'))
datadir = join_paths(prefix, get_option('datadir'))
libdir = join_paths(prefix, get_option('libdir'))

pkgdatadir = join_paths(datadir, meson.project_name())
pkglibdir = join_paths(libdir, meson.project_name())

podir = join_paths(meson.source_root(), 'po')

subdir('data')
subdir('po')
subdir('src')
subdir('tests')

meson.add_install_script('build-aux/meson/postinstall.py')
