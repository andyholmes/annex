
# Source
src_res = gnome.compile_resources('@0@.src'.format(application_id),
                                  '@0@.src.gresource.xml'.format(application_id),
  gresource_bundle: true,
           install: true,
       install_dir: pkgdatadir,
)

bin_conf = configuration_data()
bin_conf.set('GJS', find_program('gjs').path())
bin_conf.set('PACKAGE_VERSION', meson.project_version())
bin_conf.set('PACKAGE_NAME', meson.project_name())
bin_conf.set('prefix', prefix)
bin_conf.set('libdir', libdir)
bin_conf.set('datadir', datadir)


# Application
annex = configure_file(
          input: '@0@.in'.format(application_id),
         output: application_id,
  configuration: bin_conf,
        install: true,
    install_dir: bindir
)
